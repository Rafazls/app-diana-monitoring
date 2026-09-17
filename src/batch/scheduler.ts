/**
 * O relógio do monitoramento.
 *
 * A cada `intervalMs`, verifica se chegou mensagem nova. Se chegou:
 *   1. fecha um BATCH e PERSISTE  (antes de analisar — falha na análise não
 *      pode custar a mensagem);
 *   2. recupera os últimos `contextBatches` batches daquela conversa;
 *   3. analisa tudo junto, porque o padrão só aparece no contexto;
 *   4. se o veredito pedir atenção, vira alerta para o responsável.
 *
 * Conversa sem novidade não gera batch nem chamada ao modelo — num motor pago
 * por token, analisar silêncio é dinheiro jogado fora.
 */
import { randomUUID } from "node:crypto";
import type { RiskAnalyzer } from "../analyzer/index.js";
import type { Conversation, ConversationMessage } from "../contracts/index.js";
import { logger } from "../logger.js";
import type { AlertStore } from "../store/AlertStore.js";
import type { Batch, BatchStore } from "./types.js";

/** Mensagem recém-chegada, antes de virar batch. */
export interface IncomingMessage {
  conversationId: string;
  childName: string;
  contactName: string;
  message: ConversationMessage;
}

export interface SchedulerStats {
  batches: number;
  analyzed: number;
  alerted: number;
  discarded: number;
  messages: number;
  messagesByDay: Record<string, number>;
}

export interface SchedulerOptions {
  analyzer: RiskAnalyzer;
  batches: BatchStore;
  alerts: AlertStore;
  /** De quanto em quanto tempo procurar novidade. */
  intervalMs: number;
  /** Quantos batches compõem a janela de contexto. */
  contextBatches: number;
}

function dayKey(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export class BatchScheduler {
  /** Mensagens aguardando o próximo fechamento de batch, por conversa. */
  private readonly pending = new Map<string, IncomingMessage[]>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Tick em andamento. Enquanto existir, um novo tick não começa. */
  private ticking: Promise<void> | null = null;
  private puladas = 0;
  private readonly stats: SchedulerStats = {
    batches: 0,
    analyzed: 0,
    alerted: 0,
    discarded: 0,
    messages: 0,
    messagesByDay: {},
  };

  constructor(private readonly options: SchedulerOptions) {}

  getStats(): SchedulerStats {
    return { ...this.stats, messagesByDay: { ...this.stats.messagesByDay } };
  }

  /** Recebe uma mensagem da fonte. Não analisa — só acumula. */
  accept(incoming: IncomingMessage): void {
    const lista = this.pending.get(incoming.conversationId) ?? [];
    lista.push(incoming);
    this.pending.set(incoming.conversationId, lista);

    const at = new Date(incoming.message.timestamp);
    const key = dayKey(Number.isNaN(at.getTime()) ? new Date() : at);
    this.stats.messagesByDay[key] = (this.stats.messagesByDay[key] ?? 0) + 1;
    this.stats.messages += 1;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    logger.info(
      `Batches a cada ${this.options.intervalMs / 1000}s, ` +
        `analisando as últimas ${this.options.contextBatches} janelas de contexto.`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Espera o que já estava no ar antes de drenar, senão o drain seria
    // recusado pela própria trava de reentrância.
    if (this.ticking) await this.ticking;
    // Não deixa mensagem acumulada para trás.
    await this.tick();
  }

  /**
   * Uma passada, sem sobreposição.
   *
   * O timer dispara a cada `intervalMs` independentemente de a passada
   * anterior ter terminado. Quando o analisador demora mais que o intervalo
   * — modelo em CPU lenta, servidor sob carga — as passadas se acumulam e
   * disputam o mesmo recurso, o que deixa cada uma ainda mais lenta: um ciclo
   * que se realimenta até tudo estourar o timeout.
   *
   * Pular a janela não perde mensagem: o que chegou continua em `pending` e
   * entra no próximo batch, apenas mais tarde.
   */
  async tick(): Promise<void> {
    if (this.ticking) {
      this.puladas += 1;
      if (this.puladas === 1) {
        logger.warn(
          "Análise anterior ainda em andamento; esta janela foi adiada. " +
            "Se persistir, o analisador está mais lento que BATCH_INTERVAL_MS.",
        );
      }
      return;
    }

    this.ticking = this.executarTick();
    try {
      await this.ticking;
    } finally {
      this.ticking = null;
      if (this.puladas > 0) {
        logger.warn(
          `${this.puladas} janela(s) adiada(s) enquanto a análise anterior rodava. ` +
            "As mensagens não foram perdidas — entraram no batch seguinte.",
        );
        this.puladas = 0;
      }
    }
  }

  private async executarTick(): Promise<void> {
    const conversasComNovidade = [...this.pending.entries()].filter(([, m]) => m.length > 0);
    if (conversasComNovidade.length === 0) return;

    for (const [conversationId, incoming] of conversasComNovidade) {
      this.pending.set(conversationId, []);
      try {
        await this.processConversation(conversationId, incoming);
      } catch (err) {
        logger.error(`Falha ao processar a conversa ${conversationId}`, err);
      }
    }
  }

  private async processConversation(
    conversationId: string,
    incoming: IncomingMessage[],
  ): Promise<void> {
    const primeira = incoming[0];
    if (!primeira) return;

    const batch: Batch = {
      batchId: randomUUID(),
      conversationId,
      childName: primeira.childName,
      contactName: primeira.contactName,
      createdAt: new Date().toISOString(),
      messages: incoming.map((i) => i.message),
    };

    // Persiste ANTES de analisar: a mensagem não se perde se o modelo falhar.
    await this.options.batches.save(batch);
    this.stats.batches += 1;
    logger.info(
      `Batch ${batch.batchId.slice(0, 8)} salvo: ${batch.messages.length} mensagem(ns) de ${conversationId}.`,
    );

    const janela = await this.options.batches.recent(conversationId, this.options.contextBatches);
    const mensagens = janela.flatMap((b) => b.messages);
    if (mensagens.length === 0) return;

    const conversation: Conversation = {
      id: conversationId,
      childId: conversationId,
      childName: batch.childName,
      contactId: conversationId,
      contactName: batch.contactName,
      startedAt: mensagens[0]?.timestamp ?? batch.createdAt,
      messages: mensagens,
    };

    const resultado = await this.options.analyzer.analyze(conversation);
    this.stats.analyzed += 1;

    if (!resultado.assessment.requiresGuardianAttention) {
      this.stats.discarded += 1;
      logger.info(
        `Conversa ${conversationId} analisada e descartada ` +
          `(score ${resultado.assessment.score}, ${janela.length} batch(es) de contexto).`,
      );
      return;
    }

    await this.options.alerts.save(resultado, batch.childName);
    this.stats.alerted += 1;
    logger.info(
      `🚨 Alerta para ${batch.childName}: ${resultado.assessment.level} ` +
        `(score ${resultado.assessment.score}, ${resultado.signals.length} sinais, ` +
        `${janela.length} batch(es) de contexto).`,
    );
  }
}

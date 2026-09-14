/**
 * O caminho que uma conversa percorre: ingestão -> análise -> decisão -> alerta.
 *
 * A decisão é a regra que justifica o produto: só vira alerta o que realmente
 * precisa da atenção do responsável. Conversa analisada e descartada também é
 * resultado — é o que impede a fadiga de alerta.
 */
import type { RiskAnalyzer } from "./analyzer/index.js";
import type { Conversation } from "./contracts/index.js";
import type { ConversationSource } from "./ingestion/index.js";
import { logger } from "./logger.js";
import type { AlertStore } from "./store/AlertStore.js";

export interface PipelineStats {
  analyzed: number;
  alerted: number;
  discarded: number;
  /** Total de mensagens analisadas. */
  messages: number;
  /**
   * Mensagens analisadas por dia (chave `YYYY-MM-DD`) — alimenta o gráfico de
   * atividade. Contar por dia em vez de acumular num total é o que faz a série
   * de 7 dias significar alguma coisa conforme o backend vai rodando.
   */
  messagesByDay: Record<string, number>;
}

/** Chave de dia local, no formato que o gráfico agrupa. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export class Pipeline {
  private readonly stats: PipelineStats = {
    analyzed: 0,
    alerted: 0,
    discarded: 0,
    messages: 0,
    messagesByDay: {},
  };

  constructor(
    private readonly analyzer: RiskAnalyzer,
    private readonly store: AlertStore,
  ) {}

  getStats(): PipelineStats {
    return { ...this.stats, messagesByDay: { ...this.stats.messagesByDay } };
  }

  /** Liga a fonte ao pipeline. Cada conversa madura passa por aqui. */
  async connect(source: ConversationSource): Promise<void> {
    await source.start((conversation) => this.process(conversation));
  }

  async process(conversation: Conversation): Promise<void> {
    const result = await this.analyzer.analyze(conversation);

    this.stats.analyzed += 1;
    this.stats.messages += conversation.messages.length;

    // Cada mensagem conta no dia em que foi enviada, não no dia da análise:
    // uma conversa de ontem analisada agora pertence a ontem no gráfico.
    for (const message of conversation.messages) {
      const at = new Date(message.timestamp);
      const key = dayKey(Number.isNaN(at.getTime()) ? new Date() : at);
      this.stats.messagesByDay[key] = (this.stats.messagesByDay[key] ?? 0) + 1;
    }

    if (!result.assessment.requiresGuardianAttention) {
      this.stats.discarded += 1;
      logger.info(
        `Conversa ${conversation.id} analisada e descartada ` +
          `(score ${result.assessment.score}, sem risco relevante).`,
      );
      return;
    }

    await this.store.save(result, conversation.childName);
    this.stats.alerted += 1;
    logger.info(
      `🚨 Alerta para ${conversation.childName}: ${result.assessment.level} ` +
        `(score ${result.assessment.score}, ${result.signals.length} sinais).`,
    );
  }
}

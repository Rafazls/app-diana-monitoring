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
  /** Total de mensagens analisadas — alimenta o gráfico do início. */
  messages: number;
}

export class Pipeline {
  private readonly stats: PipelineStats = { analyzed: 0, alerted: 0, discarded: 0, messages: 0 };

  constructor(
    private readonly analyzer: RiskAnalyzer,
    private readonly store: AlertStore,
  ) {}

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /** Liga a fonte ao pipeline. Cada conversa madura passa por aqui. */
  async connect(source: ConversationSource): Promise<void> {
    await source.start((conversation) => this.process(conversation));
  }

  async process(conversation: Conversation): Promise<void> {
    const result = await this.analyzer.analyze(conversation);

    this.stats.analyzed += 1;
    this.stats.messages += conversation.messages.length;

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

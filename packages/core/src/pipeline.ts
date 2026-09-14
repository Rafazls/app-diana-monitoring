/**
 * O pipeline do núcleo, reduzido ao essencial da demo.
 *
 *   conversas -> analisador -> decisão -> alerta persistido
 *
 * A decisão é a regra de negócio que justifica o produto: só vira alerta o que
 * REALMENTE precisa da atenção do responsável. Conversa analisada e descartada
 * também é resultado — é o que impede a fadiga de alerta.
 */
import type { AnalysisResult, Conversation } from "@diana/contracts";
import type { RiskAnalyzer } from "@diana/analyzer";
import type { FileAlertStore } from "./alertStore.js";

export interface ConversationOutcome {
  conversationId: string;
  childName: string;
  contactName: string;
  score: number;
  level: AnalysisResult["assessment"]["level"];
  priority: AnalysisResult["assessment"]["priority"];
  signalCount: number;
  /** `true` quando gerou alerta para o responsável. */
  alerted: boolean;
  /** Caminho do arquivo gravado (apenas quando `alerted`). */
  filePath?: string;
}

export interface PipelineResult {
  outcomes: ConversationOutcome[];
  analyzed: number;
  alerted: number;
  discarded: number;
}

export interface RunPipelineOptions {
  conversations: Conversation[];
  analyzer: RiskAnalyzer;
  store: FileAlertStore;
  /** Zera os alertas anteriores antes de rodar (default: true). */
  reset?: boolean;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const { conversations, analyzer, store, reset = true } = options;

  if (reset) await store.reset();

  const outcomes: ConversationOutcome[] = [];
  const childIndex: Record<string, string> = {};

  for (const conversation of conversations) {
    const result = await analyzer.analyze(conversation);
    const alerted = result.assessment.requiresGuardianAttention;

    const outcome: ConversationOutcome = {
      conversationId: conversation.id,
      childName: conversation.childName,
      contactName: conversation.contactName,
      score: result.assessment.score,
      level: result.assessment.level,
      priority: result.assessment.priority,
      signalCount: result.signals.length,
      alerted,
    };

    if (alerted) {
      outcome.filePath = await store.save(result);
      // Só entra no índice quem virou alerta: o responsável não precisa de um
      // mapa de conversas que foram analisadas e descartadas.
      childIndex[conversation.id] = conversation.childName;
    }
    outcomes.push(outcome);
  }

  await store.saveChildIndex(childIndex);

  const alerted = outcomes.filter((o) => o.alerted).length;
  return {
    outcomes,
    analyzed: outcomes.length,
    alerted,
    discarded: outcomes.length - alerted,
  };
}

/**
 * `@diana/analyzer` — a fronteira entre o núcleo e "quem decide o risco".
 *
 * O núcleo não sabe (nem deve saber) SE o veredito veio de heurística local ou
 * de um LLM na nuvem: ele só conhece esta interface. Trocar o motor de análise
 * é trocar a implementação aqui — nenhum consumidor muda.
 */
import type { AnalysisResult, Conversation } from "../contracts/index.js";

export interface RiskAnalyzer {
  /** Nome legível do motor (aparece no `model.modelName` do resultado). */
  readonly name: string;
  /** Analisa uma conversa e devolve o veredito agregado (sem conteúdo bruto). */
  analyze(conversation: Conversation): Promise<AnalysisResult>;
}

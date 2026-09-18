/**
 * `MockRiskAnalyzer` — o motor determinístico que faz a demo rodar sem nuvem.
 *
 * Traduz as características extraídas por `features.ts` em sinais e entrega ao
 * `riskEngine` para pontuar. A divisão é a mesma dos motores de LLM: o
 * analisador APONTA os sinais, o Risk Engine CONSOLIDA — assim heurística e
 * modelo são medidos pela mesma régua, e mudar a régua muda os dois juntos.
 *
 * Determinístico de propósito: a mesma conversa sempre gera o mesmo veredito,
 * então a demo é reproduzível e os testes são estáveis.
 *
 * 🧊 RF-16: nada do texto original entra no resultado. Os sinais carregam
 * apenas ids opacos das mensagens e descrições GERADAS a partir do padrão
 * detectado — o responsável entende o porquê sem ler a conversa do filho.
 */
import type { AnalysisResult, Conversation, DetectedSignal } from "../contracts/index.js";
import { extractFeatures, type PatternHit } from "./features.js";
import { consolidate, SIGNAL_DESCRIPTIONS, SIGNAL_WEIGHTS } from "./riskEngine.js";
import type { RiskAnalyzer } from "./types.js";

/**
 * Chave da característica (como `features.ts` a nomeia) -> tipo do sinal (como
 * o contrato e a interface o nomeiam). São vocabulários diferentes de
 * propósito: um descreve o padrão léxico, o outro o que o responsável vê.
 */
const SIGNAL_TYPE: Record<string, string> = {
  secrecyRequests: "secrecy_request",
  imageRequests: "image_request",
  personalInfoRequests: "personal_information_request",
  isolationAttempts: "isolation_attempt",
  threats: "threat",
  insults: "insult",
  blackmailAttempts: "blackmail",
  sexualContentSignals: "sexual_language",
  emotionalDistressSignals: "emotional_distress",
  selfHarmSignals: "self_harm",
};

function severityFromWeight(weight: number, occurrences: number): DetectedSignal["severity"] {
  const impact = weight * Math.min(occurrences, 3);
  if (impact >= 45) return "high";
  if (impact >= 20) return "medium";
  return "low";
}

/** Confiança 0–1: cresce com repetição, satura em 0.95 (nunca afirma certeza). */
function confidenceFrom(occurrences: number): number {
  return Number(Math.min(0.55 + 0.15 * occurrences, 0.95).toFixed(2));
}

function buildSignals(hits: PatternHit[]): DetectedSignal[] {
  return hits.map((hit, index) => {
    const type = SIGNAL_TYPE[hit.key] ?? hit.key;
    const occurrences = hit.messageIds.length;
    return {
      id: `SIG-${String(index + 1).padStart(3, "0")}`,
      type,
      confidence: confidenceFrom(occurrences),
      messageIds: [...hit.messageIds],
      title: hit.label,
      description: SIGNAL_DESCRIPTIONS[type] ?? "Padrão de risco identificado na conversa.",
      severity: severityFromWeight(SIGNAL_WEIGHTS[type] ?? 10, occurrences),
    };
  });
}

export interface MockAnalyzerOptions {
  now?: () => Date;
}

export class MockRiskAnalyzer implements RiskAnalyzer {
  readonly name = "diana-mock-heuristic";
  private readonly now: () => Date;

  constructor(options: MockAnalyzerOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async analyze(conversation: Conversation): Promise<AnalysisResult> {
    const { features, hits } = extractFeatures(conversation);
    const processedAt = this.now().toISOString();

    return consolidate({
      conversationId: conversation.id,
      signals: buildSignals(hits),
      features,
      modelName: this.name,
      modelVersion: "0.1.0",
      environment: "mock",
      processedAt,
      // Etapas que só a heurística executa. Sem elas a trilha diria apenas
      // "recebido -> pontuado", escondendo de onde os sinais vieram — e a
      // auditoria existe justamente para responder isso.
      extraAudit: [
        {
          timestamp: processedAt,
          stage: "preprocessing",
          description: "Texto normalizado; identificadores pseudonimizados.",
        },
        {
          timestamp: processedAt,
          stage: "feature_extraction",
          description: "Características extraídas por padrões léxicos auditáveis.",
        },
      ],
    });
  }
}

/**
 * `MockRiskAnalyzer` — o motor determinístico que faz a demo rodar sem nuvem.
 *
 * Transforma as características extraídas em um `AnalysisResult` completo:
 * pontuação, categorias, sinais rastreáveis e uma explicação em linguagem
 * humana. Determinístico de propósito: a mesma conversa sempre gera o mesmo
 * veredito, então a demo é reproduzível e os testes são estáveis.
 *
 * 🧊 RF-16: nada do texto original entra no resultado. Os sinais carregam
 * apenas ids opacos das mensagens e descrições GERADAS a partir do padrão
 * detectado — o responsável entende o porquê sem ler a conversa do filho.
 */
import type {
  AnalysisResult,
  AuditEntry,
  ContextualFactor,
  Conversation,
  ConversationFeatures,
  DetectedSignal,
  ExplanationResult,
  RiskAssessment,
  RiskCategory,
  RiskLevel,
  RiskPrediction,
  RiskPriority,
  SignalSeverity,
} from "@diana/contracts";
import { extractFeatures, type PatternHit } from "./features.js";
import type { RiskAnalyzer } from "./types.js";

/** Peso de cada característica na pontuação final (0–100). */
const WEIGHTS: Record<string, number> = {
  secrecyRequests: 18,
  imageRequests: 26,
  personalInfoRequests: 12,
  isolationAttempts: 16,
  threats: 20,
  insults: 8,
  blackmailAttempts: 24,
  sexualContentSignals: 22,
  emotionalDistressSignals: 10,
  selfHarmSignals: 30,
};

/** Categoria do contrato correspondente a cada característica. */
const CATEGORY_OF: Record<string, RiskCategory> = {
  secrecyRequests: "grooming",
  imageRequests: "image_request",
  personalInfoRequests: "personal_information",
  isolationAttempts: "isolation",
  threats: "threat",
  insults: "cyberbullying",
  blackmailAttempts: "blackmail",
  sexualContentSignals: "sexual_content",
  emotionalDistressSignals: "emotional_distress",
  selfHarmSignals: "self_harm",
};

/** O que cada padrão significa, em linguagem de responsável. */
const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  secrecyRequests:
    "O interlocutor pediu que a conversa fosse mantida em segredo. Pedir sigilo é um dos primeiros passos da aproximação abusiva.",
  imageRequests:
    "Houve pedido de foto ou chamada de vídeo. Esse pedido exige atenção imediata, mesmo quando parece casual.",
  personalInfoRequests:
    "Foram solicitados dados pessoais (endereço, escola, rotina ou se estava sozinho). Isso pode indicar tentativa de localizar a criança.",
  isolationAttempts:
    "O interlocutor tentou afastar a criança de pais e amigos, se posicionando como a única pessoa confiável.",
  threats: "Foram identificadas mensagens com tom de ameaça ou intimidação.",
  insults: "Há mensagens hostis ou humilhantes, com padrão compatível com cyberbullying.",
  blackmailAttempts:
    "Houve tentativa de coagir a criança com a ameaça de expor algo. Chantagem costuma vir depois de um pedido atendido.",
  sexualContentSignals:
    "A conversa tomou um rumo impróprio para a idade, com insinuações de intimidade.",
  emotionalDistressSignals:
    "A criança expressou tristeza, solidão ou cansaço — sinais de sofrimento emocional que merecem acolhimento.",
  selfHarmSignals:
    "A criança usou linguagem associada a se machucar ou desaparecer. Este sinal tem prioridade sobre qualquer outro.",
};

/** Ações sugeridas por categoria, da mais específica para a mais geral. */
const ACTIONS_OF: Partial<Record<RiskCategory, string>> = {
  self_harm:
    "Procure a criança hoje, sem confronto, e considere apoio profissional. Em emergência, ligue 188 (CVV).",
  image_request:
    "Verifique se alguma imagem chegou a ser enviada e oriente a criança a não atender novos pedidos. Preserve as evidências.",
  blackmail: "Não ceda a exigências. Guarde as evidências e avalie registrar boletim de ocorrência.",
  grooming:
    "Converse com a criança sem culpabilizá-la e bloqueie o contato. Denuncie ao canal da plataforma e, se necessário, à autoridade local.",
  isolation: "Reforce com a criança que ela pode contar com você, sem punição, e acompanhe o contato.",
  threat: "Preserve as mensagens e avalie acionar a escola ou a autoridade local.",
  cyberbullying: "Acolha a criança, registre as mensagens e acione a escola se envolver colegas.",
  personal_information: "Oriente a criança a não compartilhar endereço, escola ou rotina com desconhecidos.",
  sexual_content: "Interrompa o contato e preserve as mensagens para eventual denúncia.",
  emotional_distress: "Reserve um momento tranquilo para ouvir a criança e avalie apoio psicológico.",
};

function levelFromScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score > 0) return "low";
  return "none";
}

function priorityFromScore(score: number): RiskPriority {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function severityFromWeight(weight: number, occurrences: number): SignalSeverity {
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
    const weight = WEIGHTS[hit.key] ?? 10;
    const occurrences = hit.messageIds.length;
    return {
      id: `SIG-${String(index + 1).padStart(3, "0")}`,
      type: hit.key,
      confidence: confidenceFrom(occurrences),
      messageIds: [...hit.messageIds],
      title: hit.label,
      description: SIGNAL_DESCRIPTIONS[hit.key] ?? "Padrão de risco identificado na conversa.",
      severity: severityFromWeight(weight, occurrences),
    };
  });
}

function buildCategories(features: ConversationFeatures, score: number): RiskPrediction[] {
  const predictions: RiskPrediction[] = [];
  for (const [key, category] of Object.entries(CATEGORY_OF)) {
    const count = features[key as keyof ConversationFeatures];
    if (typeof count !== "number" || count === 0) continue;
    const weight = WEIGHTS[key] ?? 10;
    const probability = Number(Math.min(0.35 + 0.2 * count + weight / 200, 0.97).toFixed(2));
    predictions.push({
      category,
      probability,
      level: levelFromScore(Math.min(100, weight * count + score / 4)),
    });
  }
  return predictions.sort((a, b) => b.probability - a.probability);
}

function buildContextualFactors(
  features: ConversationFeatures,
  signals: DetectedSignal[],
): ContextualFactor[] {
  const factors: ContextualFactor[] = [];

  if (features.suspiciousMessageCount > 0) {
    factors.push({
      type: "content",
      label: "Conteúdo das mensagens",
      description: `${features.suspiciousMessageCount} de ${features.messageCount} mensagens apresentaram padrão de risco.`,
      contribution: features.suspiciousMessageCount >= 3 ? "high" : "medium",
    });
  }

  if (features.conversationEscalation >= 0.4) {
    factors.push({
      type: "escalation",
      label: "Escalada ao longo da conversa",
      description:
        "Os sinais se concentram na parte final do diálogo, padrão típico de aproximação gradual.",
      contribution: features.conversationEscalation >= 0.7 ? "high" : "medium",
    });
  }

  if (signals.length >= 3) {
    factors.push({
      type: "combination",
      label: "Combinação de sinais",
      description: `${signals.length} tipos diferentes de sinal apareceram juntos, o que aumenta a confiança do alerta.`,
      contribution: "high",
    });
  }

  if (features.messageCount >= 8 && features.suspiciousMessageCount >= 2) {
    factors.push({
      type: "frequency",
      label: "Frequência do contato",
      description: "O contato foi intenso no período analisado, com reincidência dos padrões.",
      contribution: "medium",
    });
  }

  return factors;
}

function buildExplanation(
  assessment: RiskAssessment,
  signals: DetectedSignal[],
  features: ConversationFeatures,
): ExplanationResult {
  const topSignals = [...signals]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const principal = assessment.categories[0];
  const actions: string[] = [];
  for (const prediction of assessment.categories.slice(0, 3)) {
    const action = ACTIONS_OF[prediction.category];
    if (action && !actions.includes(action)) actions.push(action);
  }
  actions.push("Você pode marcar este alerta como útil ou falso positivo para melhorar a triagem.");

  // Sem nomes: o `AnalysisResult` é IDENTITY-FREE por contrato (é o que
  // `privacy.pseudonymizedFields` promete). Quem tem direito de ver de quem se
  // trata resolve a identidade na hora de exibir, a partir do índice separado.
  const summary =
    assessment.level === "none"
      ? "Nenhum padrão de risco relevante foi encontrado nesta conversa."
      : `A conversa monitorada apresentou ${signals.length} sinal(is) de risco em ` +
        `${features.suspiciousMessageCount} mensagem(ns)` +
        (principal ? `, com destaque para ${principal.category.replace(/_/g, " ")}.` : ".");

  return {
    summary,
    topSignals,
    contextualFactors: buildContextualFactors(features, signals),
    recommendedActions: actions,
  };
}

function buildAudit(processedAt: string, signalCount: number): AuditEntry[] {
  return [
    { timestamp: processedAt, stage: "received", description: "Conversa recebida para análise." },
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
    {
      timestamp: processedAt,
      stage: "risk_engine",
      description: `Pontuação calculada a partir de ${signalCount} sinal(is).`,
    },
    {
      timestamp: processedAt,
      stage: "explainability",
      description: "Explicação e ações recomendadas geradas para o responsável.",
    },
  ];
}

export interface MockAnalyzerOptions {
  /** Permite fixar o horário do resultado (testes determinísticos). */
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

    const rawScore = hits.reduce((total, hit) => {
      const weight = WEIGHTS[hit.key] ?? 10;
      // Repetição pesa, mas com retorno decrescente: 1ª ocorrência vale cheio.
      return total + weight * (1 + Math.min(hit.messageIds.length - 1, 2) * 0.4);
    }, 0);
    const escalationBonus = features.conversationEscalation >= 0.5 ? 8 : 0;
    const score = Math.round(Math.min(100, rawScore + escalationBonus));

    const signals = buildSignals(hits);
    const categories = buildCategories(features, score);
    const level = levelFromScore(score);

    const assessment: RiskAssessment = {
      level,
      priority: priorityFromScore(score),
      categories,
      // Automutilação e chantagem sobem o alerta independentemente da pontuação.
      requiresGuardianAttention:
        score >= 30 || features.selfHarmSignals > 0 || features.blackmailAttempts > 0,
      rationale:
        signals.length === 0
          ? "Nenhum padrão de risco conhecido foi identificado nesta conversa."
          : `Pontuação ${score}/100 a partir de ${signals.length} sinal(is) distintos` +
            (escalationBonus > 0 ? ", com escalada no final da conversa." : "."),
      score,
    };

    return {
      conversationId: conversation.id,
      assessment,
      signals,
      explanation: buildExplanation(assessment, signals, features),
      features,
      model: { modelName: this.name, version: "0.1.0", environment: "mock" },
      privacy: {
        prepared: true,
        piiMinimized: true,
        pseudonymizedFields: ["childName", "contactName"],
        protected: true,
      },
      audit: buildAudit(processedAt, signals.length),
      processedAt,
    };
  }
}

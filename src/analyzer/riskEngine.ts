/**
 * Risk Engine — transforma SINAIS em um veredito.
 *
 * Fica separado do motor que DETECTA os sinais de propósito. A heurística local
 * e o LLM na OCI fazem a mesma coisa: apontam sinais. Quem decide a gravidade,
 * a prioridade e se o responsável precisa ser incomodado é este módulo —
 * determinístico, auditável e igual para os dois.
 *
 * Isso importa porque a nota não pode variar com o humor do modelo. Se um dia o
 * LLM ficar mais verboso, o score não pode subir por causa disso.
 */
import type {
  AnalysisResult,
  AuditEntry,
  ContextualFactor,
  ConversationFeatures,
  DetectedSignal,
  ExplanationResult,
  RiskAssessment,
  RiskCategory,
  RiskLevel,
  RiskPrediction,
  RiskPriority,
} from "../contracts/index.js";

/** Peso de cada tipo de sinal na pontuação final (0–100). */
export const SIGNAL_WEIGHTS: Record<string, number> = {
  secrecy_request: 18,
  image_request: 26,
  personal_information_request: 12,
  isolation_attempt: 16,
  threat: 20,
  insult: 8,
  blackmail: 24,
  sexual_language: 22,
  emotional_distress: 10,
  self_harm: 30,
};

/** Categoria do contrato correspondente a cada tipo de sinal. */
export const CATEGORY_OF_SIGNAL: Record<string, RiskCategory> = {
  secrecy_request: "grooming",
  image_request: "image_request",
  personal_information_request: "personal_information",
  isolation_attempt: "isolation",
  threat: "threat",
  insult: "cyberbullying",
  blackmail: "blackmail",
  sexual_language: "sexual_content",
  emotional_distress: "emotional_distress",
  self_harm: "self_harm",
};

/** O que cada sinal significa, em linguagem de responsável. */
export const SIGNAL_DESCRIPTIONS: Record<string, string> = {
  secrecy_request:
    "O interlocutor pediu que a conversa fosse mantida em segredo. Pedir sigilo é um dos primeiros passos da aproximação abusiva.",
  image_request:
    "Houve pedido de foto ou chamada de vídeo. Esse pedido exige atenção imediata, mesmo quando parece casual.",
  personal_information_request:
    "Foram solicitados dados pessoais (endereço, escola, rotina ou se estava sozinho). Isso pode indicar tentativa de localizar a criança.",
  isolation_attempt:
    "O interlocutor tentou afastar a criança de pais e amigos, se posicionando como a única pessoa confiável.",
  threat: "Foram identificadas mensagens com tom de ameaça ou intimidação.",
  insult: "Há mensagens hostis ou humilhantes, com padrão compatível com cyberbullying.",
  blackmail:
    "Houve tentativa de coagir a criança com a ameaça de expor algo. Chantagem costuma vir depois de um pedido atendido.",
  sexual_language: "A conversa tomou um rumo impróprio para a idade, com insinuações de intimidade.",
  emotional_distress:
    "A criança expressou tristeza, solidão ou cansaço — sinais de sofrimento emocional que merecem acolhimento.",
  self_harm:
    "A criança usou linguagem associada a se machucar ou desaparecer. Este sinal tem prioridade sobre qualquer outro.",
};

/** Rótulo curto de cada sinal. */
export const SIGNAL_TITLES: Record<string, string> = {
  secrecy_request: "Pedido de segredo",
  image_request: "Pedido de imagem",
  personal_information_request: "Pedido de dado pessoal",
  isolation_attempt: "Tentativa de isolamento",
  threat: "Ameaça",
  insult: "Hostilidade / insulto",
  blackmail: "Chantagem",
  sexual_language: "Conteúdo impróprio",
  emotional_distress: "Sofrimento emocional",
  self_harm: "Risco de automutilação",
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
  personal_information:
    "Oriente a criança a não compartilhar endereço, escola ou rotina com desconhecidos.",
  sexual_content: "Interrompa o contato e preserve as mensagens para eventual denúncia.",
  emotional_distress: "Reserve um momento tranquilo para ouvir a criança e avalie apoio psicológico.",
};

export function levelFromScore(score: number): RiskLevel {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  if (score > 0) return "low";
  return "none";
}

export function priorityFromScore(score: number): RiskPriority {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function buildCategories(signals: DetectedSignal[], score: number): RiskPrediction[] {
  const byCategory = new Map<RiskCategory, number>();

  for (const signal of signals) {
    const category = CATEGORY_OF_SIGNAL[signal.type];
    if (!category) continue;
    byCategory.set(category, (byCategory.get(category) ?? 0) + signal.messageIds.length);
  }

  return [...byCategory.entries()]
    .map(([category, count]) => {
      const weight = SIGNAL_WEIGHTS[
        Object.keys(CATEGORY_OF_SIGNAL).find((k) => CATEGORY_OF_SIGNAL[k] === category) ?? ""
      ] ?? 10;
      return {
        category,
        probability: Number(Math.min(0.35 + 0.2 * count + weight / 200, 0.97).toFixed(2)),
        level: levelFromScore(Math.min(100, weight * count + score / 4)),
      };
    })
    .sort((a, b) => b.probability - a.probability);
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
  const topSignals = [...signals].sort((a, b) => b.confidence - a.confidence).slice(0, 3);

  const actions: string[] = [];
  for (const prediction of assessment.categories.slice(0, 3)) {
    const action = ACTIONS_OF[prediction.category];
    if (action && !actions.includes(action)) actions.push(action);
  }
  actions.push("Você pode marcar este alerta como útil ou falso positivo para melhorar a triagem.");

  const principal = assessment.categories[0];
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

export interface ConsolidateInput {
  conversationId: string;
  signals: DetectedSignal[];
  features: ConversationFeatures;
  modelName: string;
  modelVersion: string;
  environment: "mock" | "development" | "production";
  processedAt: string;
  /** Etapas extras para a trilha de auditoria (ex.: chamada ao LLM). */
  extraAudit?: AuditEntry[];
}

/**
 * Consolida sinais em `AnalysisResult`. É a ÚNICA fonte de pontuação do
 * sistema: heurística e LLM entram por aqui e saem com a mesma régua.
 */
export function consolidate(input: ConsolidateInput): AnalysisResult {
  const { signals, features, processedAt } = input;

  const rawScore = signals.reduce((total, signal) => {
    const weight = SIGNAL_WEIGHTS[signal.type] ?? 10;
    // Repetição pesa, mas com retorno decrescente: a 1ª ocorrência vale cheio.
    return total + weight * (1 + Math.min(signal.messageIds.length - 1, 2) * 0.4);
  }, 0);
  const escalationBonus = features.conversationEscalation >= 0.5 ? 8 : 0;
  const score = Math.round(Math.min(100, rawScore + escalationBonus));

  const hasSignal = (type: string) => signals.some((s) => s.type === type);

  const assessment: RiskAssessment = {
    level: levelFromScore(score),
    priority: priorityFromScore(score),
    categories: buildCategories(signals, score),
    // Automutilação e chantagem sobem o alerta independentemente da pontuação.
    requiresGuardianAttention: score >= 30 || hasSignal("self_harm") || hasSignal("blackmail"),
    rationale:
      signals.length === 0
        ? "Nenhum padrão de risco conhecido foi identificado nesta conversa."
        : `Pontuação ${score}/100 a partir de ${signals.length} sinal(is) distintos` +
          (escalationBonus > 0 ? ", com escalada no final da conversa." : "."),
    score,
  };

  const audit: AuditEntry[] = [
    { timestamp: processedAt, stage: "received", description: "Conversa recebida para análise." },
    ...(input.extraAudit ?? []),
    {
      timestamp: processedAt,
      stage: "risk_engine",
      description: `Pontuação calculada a partir de ${signals.length} sinal(is).`,
    },
    {
      timestamp: processedAt,
      stage: "explainability",
      description: "Explicação e ações recomendadas geradas para o responsável.",
    },
  ];

  return {
    conversationId: input.conversationId,
    assessment,
    signals,
    explanation: buildExplanation(assessment, signals, features),
    features,
    model: {
      modelName: input.modelName,
      version: input.modelVersion,
      environment: input.environment,
    },
    privacy: {
      prepared: true,
      piiMinimized: true,
      pseudonymizedFields: ["childName", "contactName"],
      protected: true,
    },
    audit,
    processedAt,
  };
}

/**
 * DIANA guardian-api — fixtures de demonstração (AlertRecord[]).
 *
 * Alertas mock derivados dos `mockScenarios` do núcleo
 * (`app-diana-monitoring/src/ingestor/fixtures/scenarios.ts`). São
 * `AlertRecord` completos e válidos contra o contrato `AnalysisResult`,
 * usados quando `ALERTS_SOURCE=fixtures` (default da demo).
 *
 * ⚠️ São DADOS DE TESTE — nenhuma conversa real. Coerente com a postura
 * mock-first (§8.2): sem auth, apenas dados fictícios.
 *
 * `processedAt` é ancorado num instante fixo (determinístico para os testes);
 * o `FixtureAlertReader` mantém a lista estável entre chamadas.
 */
import type {
  AlertRecord,
  AnalysisResult,
  ContextualFactor,
  DetectedSignal,
  RiskPrediction,
} from "../../contracts/index.js";

/** Nome da criança por conversa (fallback de §6.4 para a demo). */
export const demoChildNames: Record<string, string> = {
  "conv-demo-grooming": "Caio",
  "conv-demo-cyberbullying": "Caio",
  "conv-demo-personal-info": "Caio",
  "conv-demo-image-request": "Caio",
};

interface AlertSeed {
  conversationId: string;
  processedAt: string;
  scenario: string;
  contactName: string;
  signals: DetectedSignal[];
  categories: RiskPrediction[];
  factors: ContextualFactor[];
  level: AnalysisResult["assessment"]["level"];
  priority: AnalysisResult["assessment"]["priority"];
  score: number;
  requiresGuardianAttention: boolean;
  rationale: string;
  summary: string;
  recommendedActions: string[];
  features: Partial<AnalysisResult["features"]>;
}

const BASE_FEATURES: AnalysisResult["features"] = {
  secrecyRequests: 0,
  imageRequests: 0,
  personalInfoRequests: 0,
  isolationAttempts: 0,
  threats: 0,
  insults: 0,
  blackmailAttempts: 0,
  sexualContentSignals: 0,
  emotionalDistressSignals: 0,
  selfHarmSignals: 0,
  messageCount: 0,
  suspiciousMessageCount: 0,
  conversationEscalation: 0,
};

function buildAlert(seed: AlertSeed): AlertRecord {
  const result: AnalysisResult = {
    conversationId: seed.conversationId,
    assessment: {
      level: seed.level,
      priority: seed.priority,
      categories: seed.categories,
      requiresGuardianAttention: seed.requiresGuardianAttention,
      rationale: seed.rationale,
      score: seed.score,
    },
    signals: seed.signals,
    explanation: {
      summary: seed.summary,
      // topSignals = os sinais mais severos (a UI destaca estes).
      topSignals: [...seed.signals].sort((a, b) => b.confidence - a.confidence).slice(0, 3),
      contextualFactors: seed.factors,
      recommendedActions: seed.recommendedActions,
    },
    features: { ...BASE_FEATURES, ...seed.features },
    model: {
      modelName: "DIANA Risk Analyzer",
      version: "v0.1.0",
      environment: "mock",
    },
    privacy: {
      prepared: true,
      piiMinimized: true,
      pseudonymizedFields: ["contactName"],
      protected: true,
    },
    audit: [
      {
        timestamp: seed.processedAt,
        stage: "received",
        description: "Conversa recebida para análise",
      },
      { timestamp: seed.processedAt, stage: "preprocessing", description: "Dados preparados" },
      {
        timestamp: seed.processedAt,
        stage: "feature_extraction",
        description: `${seed.features.messageCount ?? 0} mensagens analisadas`,
      },
      {
        timestamp: seed.processedAt,
        stage: "ml_analysis",
        description: "Modelo mock avaliou padrões",
      },
      {
        timestamp: seed.processedAt,
        stage: "context_analysis",
        description: "Contexto relacionado",
      },
      {
        timestamp: seed.processedAt,
        stage: "risk_engine",
        description: `Prioridade: ${seed.priority}`,
      },
      { timestamp: seed.processedAt, stage: "explainability", description: "Explicação gerada" },
    ],
    processedAt: seed.processedAt,
  };

  return {
    conversationId: seed.conversationId,
    processedAt: seed.processedAt,
    result,
  };
}

const seeds: AlertSeed[] = [
  {
    conversationId: "conv-demo-grooming",
    processedAt: "2026-09-13T14:47:00.000Z",
    scenario: "grooming",
    contactName: "Contato-1",
    level: "high",
    priority: "high",
    score: 73,
    requiresGuardianAttention: true,
    rationale:
      "Combinação de pedido de segredo, solicitação de imagem e tentativa de isolamento com progressão dentro da janela analisada.",
    summary:
      "Padrão consistente com possível grooming: a outra pessoa pede segredo, solicita uma foto e desencoraja a criança de contar aos responsáveis.",
    categories: [
      { category: "grooming", probability: 0.9, level: "high" },
      { category: "image_request", probability: 0.6, level: "medium" },
      { category: "isolation", probability: 0.55, level: "medium" },
    ],
    signals: [
      {
        id: "sig-secrecy_request",
        type: "secrecy_request",
        confidence: 0.67,
        messageIds: ["MSG-grooming-07", "MSG-grooming-10"],
        title: "Pedido de segredo",
        description:
          "A outra pessoa pediu que a criança mantivesse a conversa escondida dos responsáveis.",
        severity: "high",
      },
      {
        id: "sig-image_request",
        type: "image_request",
        confidence: 0.6,
        messageIds: ["MSG-grooming-10"],
        title: "Solicitação de imagem",
        description: "Foi identificada uma solicitação para que a criança envie uma foto pessoal.",
        severity: "high",
      },
      {
        id: "sig-isolation_attempt",
        type: "isolation_attempt",
        confidence: 0.6,
        messageIds: ["MSG-grooming-09"],
        title: "Tentativa de isolamento",
        description:
          "A conversa contém linguagem que pode desencorajar a criança de conversar com os responsáveis.",
        severity: "high",
      },
    ],
    factors: [
      {
        type: "combination",
        label: "Combinação de sinais",
        description: "Segredo + imagem + isolamento na mesma janela.",
        contribution: "high",
      },
      {
        type: "escalation",
        label: "Progressão",
        description: "A conversa evolui de aproximação para pedido de imagem.",
        contribution: "high",
      },
    ],
    recommendedActions: [
      "Converse com a criança em um momento tranquilo, sem acusações.",
      "Preserve as evidências e evite confrontar o contato diretamente.",
      "Considere acionar canais de proteção se houver contato presencial.",
    ],
    features: {
      secrecyRequests: 2,
      imageRequests: 1,
      isolationAttempts: 1,
      messageCount: 11,
      suspiciousMessageCount: 4,
      conversationEscalation: 0.7,
    },
  },
  {
    conversationId: "conv-demo-cyberbullying",
    processedAt: "2026-09-13T16:22:00.000Z",
    scenario: "cyberbullying",
    contactName: "Contato-2",
    level: "medium",
    priority: "medium",
    score: 54,
    requiresGuardianAttention: true,
    rationale:
      "Insultos repetidos e linguagem hostil direcionada à criança, com sinais de sofrimento emocional.",
    summary:
      "Sequência de mensagens hostis e depreciativas dirigidas à criança, com indícios de sofrimento emocional.",
    categories: [
      { category: "cyberbullying", probability: 0.82, level: "high" },
      { category: "emotional_distress", probability: 0.45, level: "medium" },
      { category: "threat", probability: 0.2, level: "low" },
    ],
    signals: [
      {
        id: "sig-insult",
        type: "insult",
        confidence: 0.7,
        messageIds: ["MSG-bully-05", "MSG-bully-07", "MSG-bully-10"],
        title: "Insulto / agressão verbal",
        description: "Linguagem depreciativa ou hostil direcionada à criança.",
        severity: "medium",
      },
      {
        id: "sig-emotional_distress",
        type: "emotional_distress",
        confidence: 0.4,
        messageIds: ["MSG-bully-09"],
        title: "Sinais de sofrimento emocional",
        description: "A criança demonstra desconforto, tristeza ou angústia.",
        severity: "low",
      },
    ],
    factors: [
      {
        type: "frequency",
        label: "Recorrência",
        description: "Insultos repetidos na mesma janela.",
        contribution: "medium",
      },
      {
        type: "content",
        label: "Hostilidade",
        description: "Linguagem depreciativa dirigida à criança.",
        contribution: "high",
      },
    ],
    recommendedActions: [
      "Acolha a criança e valide o que ela está sentindo.",
      "Registre as mensagens e comunique a escola, se aplicável.",
    ],
    features: {
      insults: 3,
      emotionalDistressSignals: 1,
      messageCount: 10,
      suspiciousMessageCount: 4,
      conversationEscalation: 0.5,
    },
  },
  {
    conversationId: "conv-demo-personal-info",
    processedAt: "2026-09-13T18:36:00.000Z",
    scenario: "personal-info",
    contactName: "Contato-3",
    level: "medium",
    priority: "medium",
    score: 58,
    requiresGuardianAttention: true,
    rationale:
      "Coleta progressiva de dados pessoais (idade, escola, endereço) por um contato desconhecido.",
    summary:
      "Um contato solicita dados que permitem identificar e localizar a criança (idade, escola e endereço).",
    categories: [
      { category: "personal_information", probability: 0.78, level: "high" },
      { category: "grooming", probability: 0.35, level: "medium" },
    ],
    signals: [
      {
        id: "sig-personal_information_request",
        type: "personal_information_request",
        confidence: 0.72,
        messageIds: ["MSG-pinfo-03", "MSG-pinfo-05", "MSG-pinfo-07", "MSG-pinfo-09"],
        title: "Solicitação de dados pessoais",
        description: "Perguntas por informações que permitem identificar ou localizar a criança.",
        severity: "medium",
      },
      {
        id: "sig-personal_information_shared",
        type: "personal_information_shared",
        confidence: 0.5,
        messageIds: ["MSG-pinfo-08", "MSG-pinfo-10"],
        title: "Dados pessoais compartilhados",
        description: "A criança compartilhou informações pessoais na conversa.",
        severity: "low",
      },
    ],
    factors: [
      {
        type: "sequence",
        label: "Escalada de perguntas",
        description: "Idade → escola → endereço em sequência.",
        contribution: "high",
      },
    ],
    recommendedActions: [
      "Explique à criança por que não deve compartilhar endereço/escola online.",
      "Reveja as configurações de privacidade dos aplicativos usados.",
    ],
    features: {
      personalInfoRequests: 4,
      messageCount: 10,
      suspiciousMessageCount: 5,
      conversationEscalation: 0.6,
    },
  },
  {
    conversationId: "conv-demo-image-request",
    processedAt: "2026-09-13T20:28:00.000Z",
    scenario: "image-request",
    contactName: "Contato-4",
    level: "high",
    priority: "high",
    score: 69,
    requiresGuardianAttention: true,
    rationale:
      "Solicitação insistente de foto pessoal com promessa de sigilo, padrão de risco elevado.",
    summary:
      "A outra pessoa insiste para que a criança envie uma foto pessoal e promete não mostrar a ninguém.",
    categories: [
      { category: "image_request", probability: 0.85, level: "high" },
      { category: "grooming", probability: 0.5, level: "medium" },
    ],
    signals: [
      {
        id: "sig-image_request",
        type: "image_request",
        confidence: 0.75,
        messageIds: ["MSG-img-07", "MSG-img-09", "MSG-img-10"],
        title: "Solicitação de imagem",
        description: "Foi identificada uma solicitação para que a criança envie uma foto pessoal.",
        severity: "high",
      },
      {
        id: "sig-secrecy_request",
        type: "secrecy_request",
        confidence: 0.55,
        messageIds: ["MSG-img-09"],
        title: "Pedido de segredo",
        description:
          "A outra pessoa pediu que a criança mantivesse a conversa escondida dos responsáveis.",
        severity: "high",
      },
    ],
    factors: [
      {
        type: "combination",
        label: "Imagem + sigilo",
        description: "Pedido de foto acompanhado de promessa de sigilo.",
        contribution: "high",
      },
    ],
    recommendedActions: [
      "Oriente a criança a nunca enviar fotos a contatos desconhecidos.",
      "Preserve as evidências e considere bloquear o contato.",
    ],
    features: {
      imageRequests: 3,
      secrecyRequests: 1,
      messageCount: 11,
      suspiciousMessageCount: 4,
      conversationEscalation: 0.65,
    },
  },
];

/** Alertas de demonstração (nova lista a cada chamada, sem estado partilhado). */
export function demoAlertRecords(): AlertRecord[] {
  return seeds.map(buildAlert);
}

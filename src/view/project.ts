import type {
  AlertRecord,
  AnalysisResult,
  ContextualFactor,
  DetectedSignal,
  RiskPrediction,
  RiskPriority,
} from "../contracts/index.js";
import { riskCategoryLabels } from "../contracts/index.js";
import { logger } from "../logger.js";
import { encodeAlertId } from "./alertId.js";
import type { AlertDetailPayload, AlertItem, ViewPriority } from "./types.js";

/** Chaves que nunca podem aparecer no que sai para a tela. */
const FORBIDDEN_RAW_KEYS = new Set([
  "messages",
  "text",
  "conversation",
  "rawText",
  "transcript",
  "snippet",
  "content",
  "excerpt",
  "body",
  "messageText",
]);

/**
 * Varre o payload atrás de conteúdo bruto. `messageIds` é permitido: são
 * referências opacas que permitem auditoria sem expor nada.
 */
export function assertNoRawContent(value: unknown, path = "root"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoRawContent(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_RAW_KEYS.has(key)) {
      throw new Error(`RF-16: campo bruto proibido "${key}" em ${path} — serialização abortada.`);
    }
    assertNoRawContent(child, `${path}.${key}`);
  }
}

/**
 * `RiskPriority` -> prioridade da tela. Valor fora do contrato cai em "alta":
 * fail-safe, nunca subestima um risco desconhecido — e fica registrado.
 */
export function toViewPriority(priority: RiskPriority): ViewPriority {
  switch (priority) {
    case "high":
      return "alta";
    case "medium":
      return "media";
    case "low":
      return "baixa";
    default:
      logger.warn(`Prioridade fora do contrato "${String(priority)}" — usando "alta".`);
      return "alta";
  }
}

/** Rótulo relativo ("Agora", "Ontem", "Seg") a partir de um ISO. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;

  const diffMs = now.getTime() - then.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return "Agora";

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const days = Math.round((startOfToday - startOfThen) / 86_400_000);

  if (days <= 0) return "Hoje";
  if (days === 1) return "Ontem";
  if (days < 7) return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][then.getDay()] ?? "";
  return then.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Categoria principal = a de maior probabilidade. */
function principalCategory(categories: RiskPrediction[]): RiskPrediction | null {
  if (categories.length === 0) return null;
  return categories.reduce((best, current) =>
    current.probability > best.probability ? current : best,
  );
}

/** Projeção por allowlist de um sinal. */
function toViewSignal(signal: DetectedSignal): DetectedSignal {
  return {
    id: signal.id,
    type: signal.type,
    confidence: signal.confidence,
    messageIds: [...signal.messageIds],
    title: signal.title,
    description: signal.description,
    severity: signal.severity,
  };
}

/** Projeção por allowlist de um fator contextual. */
function toViewFactor(factor: ContextualFactor): ContextualFactor {
  return {
    type: factor.type,
    label: factor.label,
    description: factor.description,
    contribution: factor.contribution,
  };
}

/** Projeção por allowlist de uma categoria. */
function toViewCategory(prediction: RiskPrediction): RiskPrediction {
  return {
    category: prediction.category,
    probability: prediction.probability,
    level: prediction.level,
  };
}

export interface ProjectOptions {
  childName?: string;
  read?: boolean;
  now?: Date;
}

/** Item de lista a partir de um alerta persistido. */
export function toAlertItem(record: AlertRecord, opts: ProjectOptions = {}): AlertItem {
  const principal = principalCategory(record.result.assessment.categories);
  const category = principal ? riskCategoryLabels[principal.category] : "Risco não classificado";

  const item: AlertItem = {
    id: encodeAlertId(record.conversationId, record.processedAt),
    title: category,
    child: opts.childName ?? "Criança",
    time: relativeTime(record.processedAt, opts.now ?? new Date()),
    priority: toViewPriority(record.result.assessment.priority),
    read: opts.read ?? false,
    category,
  };

  assertNoRawContent(item, "AlertItem");
  return item;
}

/** Detalhe a partir de um alerta persistido — `AnalysisResult` reprojetado. */
export function toAlertDetail(record: AlertRecord, opts: ProjectOptions = {}): AlertDetailPayload {
  const result = record.result;

  const analysis: AnalysisResult = {
    conversationId: result.conversationId,
    assessment: {
      level: result.assessment.level,
      priority: result.assessment.priority,
      categories: result.assessment.categories.map(toViewCategory),
      requiresGuardianAttention: result.assessment.requiresGuardianAttention,
      rationale: result.assessment.rationale,
      score: result.assessment.score,
    },
    signals: result.signals.map(toViewSignal),
    explanation: {
      summary: result.explanation.summary,
      topSignals: result.explanation.topSignals.map(toViewSignal),
      contextualFactors: result.explanation.contextualFactors.map(toViewFactor),
      recommendedActions: [...result.explanation.recommendedActions],
    },
    features: { ...result.features },
    model: {
      modelName: result.model.modelName,
      version: result.model.version,
      environment: result.model.environment,
    },
    privacy: {
      prepared: result.privacy.prepared,
      piiMinimized: result.privacy.piiMinimized,
      pseudonymizedFields: [...result.privacy.pseudonymizedFields],
      protected: result.privacy.protected,
    },
    audit: result.audit.map((entry) => ({
      timestamp: entry.timestamp,
      stage: entry.stage,
      description: entry.description,
    })),
    processedAt: result.processedAt,
  };

  const payload: AlertDetailPayload = {
    analysis,
    childName: opts.childName ?? "Criança",
    detectedTime: relativeTime(record.processedAt, opts.now ?? new Date()),
  };

  assertNoRawContent(payload, "AlertDetail");
  return payload;
}

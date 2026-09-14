/**
 * Tipos de VISÃO — o que a API serve à UI do responsável.
 *
 * São as PROJEÇÕES do `AnalysisResult`/`AlertRecord`, minimizadas para a tela
 * (RF-16). Vivem no contrato compartilhado porque têm DOIS donos: a API os
 * produz (`guardian-api` -> `domain/summarize.ts`) e a web os consome. Tipar os
 * dois lados com o mesmo arquivo é o que impede a interface de derivar do que a
 * API realmente devolve.
 */
import type { ContextualFactor, RiskLevel, RiskPrediction } from "./types.js";

/** Prioridade apresentada na UI (mapeada de `RiskPriority` do contrato). */
export type GuardianPriority = "alta" | "media" | "baixa";

/**
 * Item de lista (`GET /alerts`). Mínimo para a `AlertsList`/`Dashboard`.
 */
export interface AlertSummary {
  /** alertId reversível (§6.3): base64url("<conversationId>|<processedAt>"). */
  id: string;
  conversationId: string;
  /** Ver §6.4: fallback "Criança" quando o núcleo não fornece o nome. */
  childName: string;
  /** Rótulo curto da categoria principal. */
  title: string;
  /** riskCategoryLabels[categoria principal]. */
  category: string;
  priority: GuardianPriority;
  level: RiskLevel;
  /** 0–100. */
  score: number;
  requiresGuardianAttention: boolean;
  /** = processedAt (ISO 8601). */
  detectedAt: string;
}

/** Sinal resumido para a UI (sem conteúdo bruto de mensagem). */
export interface AlertViewSignal {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  /** 0–1. */
  confidence: number;
  /** Referências opacas (ex.: "MSG-1291"); a UI usa apenas `.length`. */
  messageIds: string[];
  /** Nº de ocorrências (= messageIds.length) — conveniência para a UI. */
  occurrences: number;
}

/** Explicação resumida para a UI. */
export interface AlertViewExplanation {
  summary: string;
  topSignals: AlertViewSignal[];
  contextualFactors: ContextualFactor[];
  recommendedActions: string[];
}

/**
 * Detalhe (`GET /alerts/{id}`): o `AnalysisResult` JÁ resumido para o
 * responsável — exatamente o que o `AlertDetail` do protótipo consome.
 * NUNCA inclui `Conversation`/texto de mensagem (RF-16).
 */
export interface AlertView {
  id: string;
  conversationId: string;
  childName: string;
  detectedAt: string;
  priority: GuardianPriority;
  level: RiskLevel;
  score: number;
  requiresGuardianAttention: boolean;
  rationale: string;
  categories: RiskPrediction[];
  signals: AlertViewSignal[];
  explanation: AlertViewExplanation;
  model: {
    modelName: string;
    version: string;
    environment: "mock" | "development" | "production";
  };
}

/** Feedback do responsável (§9). */
export type FeedbackVerdict = "useful" | "false_positive" | "not_sure";

export interface FeedbackRecord {
  alertId: string;
  conversationId: string;
  processedAt: string;
  verdict: FeedbackVerdict;
  note?: string;
  /** ISO 8601. */
  createdAt: string;
}

/** Preferências do responsável (§7.4). Documento único global no MVP. */
export interface GuardianSettingsItem {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface GuardianSettingsSection {
  id: string;
  title: string;
  items: GuardianSettingsItem[];
}

export interface GuardianSettings {
  sections: GuardianSettingsSection[];
}

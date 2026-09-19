import { z } from "zod";
import type { AlertRecord } from "./alertRecord.js";
import type { AnalysisResult } from "./types.js";

const riskCategorySchema = z.enum([
  "grooming",
  "image_request",
  "cyberbullying",
  "blackmail",
  "threat",
  "personal_information",
  "isolation",
  "sexual_content",
  "emotional_distress",
  "self_harm",
]);

const riskLevelSchema = z.enum(["none", "low", "medium", "high", "critical"]);
const riskPrioritySchema = z.enum(["low", "medium", "high"]);
const severitySchema = z.enum(["low", "medium", "high"]);

const detectedSignalSchema = z.object({
  id: z.string(),
  type: z.string(),
  confidence: z.number(),
  messageIds: z.array(z.string()),
  title: z.string(),
  description: z.string(),
  severity: severitySchema,
});

const riskPredictionSchema = z.object({
  category: riskCategorySchema,
  probability: z.number(),
  level: riskLevelSchema,
});

const contextualFactorSchema = z.object({
  type: z.enum(["content", "sequence", "frequency", "escalation", "combination"]),
  label: z.string(),
  description: z.string(),
  contribution: severitySchema,
});

const conversationFeaturesSchema = z.object({
  secrecyRequests: z.number(),
  imageRequests: z.number(),
  personalInfoRequests: z.number(),
  isolationAttempts: z.number(),
  threats: z.number(),
  insults: z.number(),
  blackmailAttempts: z.number(),
  sexualContentSignals: z.number(),
  emotionalDistressSignals: z.number(),
  selfHarmSignals: z.number(),
  messageCount: z.number(),
  suspiciousMessageCount: z.number(),
  conversationEscalation: z.number(),
});

export const analysisResultSchema: z.ZodType<AnalysisResult> = z.object({
  conversationId: z.string(),
  assessment: z.object({
    level: riskLevelSchema,
    priority: riskPrioritySchema,
    categories: z.array(riskPredictionSchema),
    requiresGuardianAttention: z.boolean(),
    rationale: z.string(),
    score: z.number(),
  }),
  signals: z.array(detectedSignalSchema),
  explanation: z.object({
    summary: z.string(),
    topSignals: z.array(detectedSignalSchema),
    contextualFactors: z.array(contextualFactorSchema),
    recommendedActions: z.array(z.string()),
  }),
  features: conversationFeaturesSchema,
  model: z.object({
    modelName: z.string(),
    version: z.string(),
    environment: z.enum(["mock", "development", "production"]),
  }),
  privacy: z.object({
    prepared: z.boolean(),
    piiMinimized: z.boolean(),
    pseudonymizedFields: z.array(z.string()),
    protected: z.boolean(),
  }),
  audit: z.array(z.object({ timestamp: z.string(), stage: z.string(), description: z.string() })),
  processedAt: z.string(),
});

export const alertRecordSchema: z.ZodType<AlertRecord> = z.object({
  conversationId: z.string(),
  processedAt: z.string(),
  result: analysisResultSchema,
});

/**
 * Valida um valor desconhecido como `AlertRecord`. Devolve `{ ok, record }` ou
 * `{ ok: false, error }` — nunca lança (o chamador decide logar/pular).
 */
export function parseAlertRecord(
  value: unknown,
): { ok: true; record: AlertRecord } | { ok: false; error: string } {
  const parsed = alertRecordSchema.safeParse(value);
  if (parsed.success) return { ok: true, record: parsed.data };
  const error = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { ok: false, error };
}

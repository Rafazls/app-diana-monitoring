import { describe, expect, it } from "vitest";
import { z } from "zod";
import { demoAlertRecords } from "../src/sources/fixtures/demoAlerts.js";

/**
 * Schema de parse do `AlertRecord`/`AnalysisResult` (espelha o contrato do
 * núcleo). As fixtures DEVEM validar contra ele — se o contrato divergir, o
 * teste falha (sinal de deriva; ver §4/§10 da análise).
 */
const riskCategory = z.enum([
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
const riskLevel = z.enum(["none", "low", "medium", "high", "critical"]);
const severity = z.enum(["low", "medium", "high"]);

const detectedSignal = z.object({
  id: z.string(),
  type: z.string(),
  confidence: z.number().min(0).max(1),
  messageIds: z.array(z.string()),
  title: z.string(),
  description: z.string(),
  severity,
});

const analysisResult = z.object({
  conversationId: z.string(),
  assessment: z.object({
    level: riskLevel,
    priority: z.enum(["low", "medium", "high"]),
    categories: z.array(
      z.object({ category: riskCategory, probability: z.number(), level: riskLevel }),
    ),
    requiresGuardianAttention: z.boolean(),
    rationale: z.string(),
    score: z.number().min(0).max(100),
  }),
  signals: z.array(detectedSignal),
  explanation: z.object({
    summary: z.string(),
    topSignals: z.array(detectedSignal),
    contextualFactors: z.array(
      z.object({
        type: z.enum(["content", "sequence", "frequency", "escalation", "combination"]),
        label: z.string(),
        description: z.string(),
        contribution: severity,
      }),
    ),
    recommendedActions: z.array(z.string()),
  }),
  features: z.record(z.number()),
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

const alertRecord = z.object({
  conversationId: z.string(),
  processedAt: z.string(),
  result: analysisResult,
});

describe("contrato — fixtures parseiam como AlertRecord", () => {
  it("todas as fixtures validam contra o schema do contrato", () => {
    const records = demoAlertRecords();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(() => alertRecord.parse(record)).not.toThrow();
    }
  });

  it("nenhuma fixture carrega a Conversation integral (RF-16)", () => {
    for (const record of demoAlertRecords()) {
      expect(record.result).not.toHaveProperty("messages");
      expect(record.result).not.toHaveProperty("conversation");
    }
  });
});

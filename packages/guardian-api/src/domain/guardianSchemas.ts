/**
 * DIANA guardian-api — schemas zod dos dados do responsável (settings/feedback).
 *
 * Fonte ÚNICA destes schemas: reusados tanto na validação de ENTRADA HTTP
 * (`http/validation.ts`) quanto na validação de LEITURA de disco
 * (`store/*`), para não haver deriva entre o que se aceita e o que se lê.
 */
import { z } from "zod";
import type { FeedbackRecord, GuardianSettings } from "./viewTypes.js";

const settingsItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  enabled: z.boolean(),
});

const settingsSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  items: z.array(settingsItemSchema),
});

/** `GuardianSettings` (documento único global, §7.4). */
export const guardianSettingsSchema: z.ZodType<GuardianSettings> = z.object({
  sections: z.array(settingsSectionSchema),
});

/** `FeedbackRecord` persistido (§9). */
export const feedbackRecordSchema: z.ZodType<FeedbackRecord> = z.object({
  alertId: z.string(),
  conversationId: z.string(),
  processedAt: z.string(),
  verdict: z.enum(["useful", "false_positive", "not_sure"]),
  note: z.string().optional(),
  createdAt: z.string(),
});

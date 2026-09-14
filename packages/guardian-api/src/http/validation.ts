/**
 * DIANA guardian-api — schemas de validação (zod) de entrada HTTP.
 *
 * Os schemas de settings/feedback vêm de `domain/guardianSchemas.ts` (fonte
 * única, compartilhada com a validação de leitura de disco em `store/*`).
 */
import { z } from "zod";
import { guardianSettingsSchema } from "../domain/guardianSchemas.js";

/** Body de `POST /alerts/:id/feedback` (§7.3). */
export const feedbackBodySchema = z.object({
  verdict: z.enum(["useful", "false_positive", "not_sure"]),
  note: z.string().max(2000).optional(),
});

export type FeedbackBody = z.infer<typeof feedbackBodySchema>;

/** Body de `PUT /settings` (§7.4). */
export const settingsBodySchema = guardianSettingsSchema;

/** Query de `GET /alerts` (§7.1) — filtros opcionais. */
export const alertsQuerySchema = z.object({
  priority: z.enum(["alta", "media", "baixa"]).optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

export type AlertsQuery = z.infer<typeof alertsQuerySchema>;

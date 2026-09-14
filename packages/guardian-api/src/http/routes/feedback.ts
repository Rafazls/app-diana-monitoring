/**
 * DIANA guardian-api — `POST /alerts/:id/feedback` (§7.3, §9).
 *
 * Valida o body (zod), decodifica o alertId, confirma que o alerta existe e
 * grava um `FeedbackRecord`. Idempotência: o último feedback prevalece.
 */
import type { FastifyInstance } from "fastify";
import { decodeAlertId, encodeAlertId } from "../../domain/alertId.js";
import type { FeedbackRecord } from "../../domain/viewTypes.js";
import type { AppDeps } from "../deps.js";
import { feedbackBodySchema } from "../validation.js";

export function registerFeedbackRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post<{ Params: { id: string } }>("/alerts/:id/feedback", async (request, reply) => {
    const ref = decodeAlertId(request.params.id);
    if (!ref) {
      return reply.code(400).send({ error: "bad_request", message: "alertId malformado." });
    }

    const parsed = feedbackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }

    // O alerta precisa existir (feedback é sempre sobre um alerta conhecido).
    const record = await deps.reader.getAlert(ref.conversationId, ref.processedAt);
    if (!record) {
      return reply.code(404).send({ error: "not_found", message: "Alerta não encontrado." });
    }

    const feedback: FeedbackRecord = {
      alertId: encodeAlertId(ref.conversationId, ref.processedAt),
      conversationId: ref.conversationId,
      processedAt: ref.processedAt,
      verdict: parsed.data.verdict,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      createdAt: new Date().toISOString(),
    };

    await deps.feedbackStore.save(feedback);
    return reply.code(201).send(feedback);
  });
}

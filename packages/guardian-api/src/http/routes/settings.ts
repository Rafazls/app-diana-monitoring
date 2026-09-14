/**
 * DIANA guardian-api — `GET /settings` · `PUT /settings` (§7.4).
 *
 * Documento único global no MVP (sem multiusuário — só com auth, Fase 2).
 * `GET` retorna o default se ausente; `PUT` valida (zod) e persiste.
 */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";
import { settingsBodySchema } from "../validation.js";

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/settings", async (_request, reply) => {
    const settings = await deps.settingsStore.get();
    return reply.send(settings);
  });

  app.put("/settings", async (request, reply) => {
    const parsed = settingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const saved = await deps.settingsStore.put(parsed.data);
    return reply.send(saved);
  });
}

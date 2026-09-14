/**
 * DIANA guardian-api — `GET /health` (§7.5). Sem auth. Readiness/liveness.
 */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", async () => {
    return {
      status: "ok",
      source: deps.config.alertsSource,
      writeBackend: deps.config.writeBackend,
      uptime: Math.round(process.uptime()),
    };
  });
}

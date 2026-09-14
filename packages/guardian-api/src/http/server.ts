/**
 * DIANA guardian-api — montagem do servidor Fastify.
 *
 * `buildServer(deps)` cria a instância com CORS + hook de auth + rotas, sem
 * abrir socket (ideal para testes com `fastify.inject`). `createServer(config)`
 * compõe as dependências (reader + stores) a partir da config.
 */
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "../config/env.js";
import { createAlertReader } from "../sources/index.js";
import { createFeedbackStore, createSettingsStore } from "../store/index.js";
import { createApiKeyHook } from "./auth.js";
import type { AppDeps } from "./deps.js";
import { registerAlertRoutes } from "./routes/alerts.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerSettingsRoutes } from "./routes/settings.js";

export function buildServer(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
    },
  });

  // CORS restrito a `CORS_ORIGINS` ("*" só em demo local).
  const allowAllOrigins = deps.config.corsOrigins.includes("*");
  app.register(cors, {
    origin: allowAllOrigins ? true : deps.config.corsOrigins,
  });

  // Hook único de auth (§8): no-op quando `GUARDIAN_API_KEY` vazio.
  app.addHook("onRequest", createApiKeyHook(deps.config.apiKey));

  // Error handler global: resposta genérica e previsível; o detalhe fica só no
  // log do servidor (reforça RF-16 também no caminho de erro — nada de conteúdo
  // ou stack na resposta).
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Erro não tratado");
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      return reply.code(500).send({ error: "internal_error", message: "Erro interno." });
    }
    return reply.code(status).send({ error: "request_error", message: "Requisição inválida." });
  });

  registerHealthRoutes(app, deps);
  registerAlertRoutes(app, deps);
  registerFeedbackRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  return app;
}

export function composeDeps(config: AppConfig): AppDeps {
  return {
    config,
    reader: createAlertReader(config),
    feedbackStore: createFeedbackStore(config),
    settingsStore: createSettingsStore(config),
  };
}

export function createServer(config: AppConfig): FastifyInstance {
  return buildServer(composeDeps(config));
}

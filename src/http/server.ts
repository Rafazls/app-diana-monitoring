import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/env.js";
import { registerRoutes, type Deps } from "./routes.js";

/** Rotas isentas de chave (readiness do container). */
const PUBLIC_PATHS = new Set(["/health"]);

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createServer(config: AppConfig, deps: Deps): FastifyInstance {
  const app = Fastify({ logger: { level: config.logLevel } });

  void app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
  });


  if (config.apiKey) {
    app.addHook("onRequest", (request, reply, done) => {
      if (PUBLIC_PATHS.has(request.routeOptions.url ?? request.url)) return done();

      const provided = request.headers["x-api-key"];
      const value = Array.isArray(provided) ? provided[0] : provided;
      if (typeof value === "string" && safeEquals(value, config.apiKey)) return done();

      reply.code(401).send({ error: "unauthorized", message: "x-api-key ausente ou inválida." });
    });
  }

  registerRoutes(app, deps);
  return app;
}

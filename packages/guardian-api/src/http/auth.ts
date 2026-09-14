/**
 * DIANA guardian-api — hook de autenticação (§8).
 *
 * 🧊 DECISÃO DO MVP: SEM autenticação/IAM. Este hook é um SEAM único:
 *   - `GUARDIAN_API_KEY` vazio  -> API aberta (no-op), apenas para demo;
 *   - `GUARDIAN_API_KEY` definido -> exige header `x-api-key` correspondente
 *     (comparação em tempo constante), exceto em `/health`.
 *
 * A chave simples é um FREIO DE DEMONSTRAÇÃO, não controle de acesso real:
 * não há identidade, autorização por responsável nem auditoria (§8.2).
 *
 * 🔜 Fase 2 (§8.3): trocar a implementação deste hook por validação de token
 * OIDC (ex.: OCI IAM Identity Domains) — ADIÇÃO, não reescrita. O restante do
 * serviço não muda.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, onRequestHookHandler } from "fastify";

/** Rotas isentas de auth (readiness/liveness da Container Instance). */
const PUBLIC_PATHS = new Set(["/health"]);

/** Comparação de strings em tempo constante (evita timing attack). */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createApiKeyHook(apiKey: string): onRequestHookHandler {
  return function apiKeyHook(request: FastifyRequest, reply: FastifyReply, done: () => void) {
    // API aberta (demo) — no-op.
    if (apiKey.length === 0) return done();

    // `/health` sempre público.
    if (PUBLIC_PATHS.has(request.routeOptions.url ?? request.url)) return done();

    const provided = request.headers["x-api-key"];
    const value = Array.isArray(provided) ? provided[0] : provided;
    if (typeof value === "string" && safeEquals(value, apiKey)) return done();

    reply.code(401).send({ error: "unauthorized", message: "x-api-key ausente ou inválida." });
  };
}

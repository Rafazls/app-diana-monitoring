import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config/env.js";
import { encodeAlertId } from "../src/domain/alertId.js";
import { buildServer, composeDeps } from "../src/http/server.js";

function makeServer(env: NodeJS.ProcessEnv = {}): FastifyInstance {
  const config = loadConfig({ ALERTS_SOURCE: "fixtures", ...env });
  return buildServer(composeDeps(config));
}

const groomingId = encodeAlertId("conv-demo-grooming", "2026-09-13T14:47:00.000Z");

describe("HTTP (fixtures, sem auth)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = makeServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /health responde ok sem auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", source: "fixtures" });
  });

  it("GET /alerts lista resumos ordenados desc", async () => {
    const res = await app.inject({ method: "GET", url: "/alerts" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: Array<{ detectedAt: string }> };
    expect(body.items.length).toBe(4);
    const dates = body.items.map((i) => i.detectedAt);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it("GET /alerts filtra por prioridade", async () => {
    const res = await app.inject({ method: "GET", url: "/alerts?priority=alta" });
    const body = res.json() as { items: Array<{ priority: string }> };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.priority === "alta")).toBe(true);
  });

  it("GET /alerts pagina com limit+cursor", async () => {
    const first = await app.inject({ method: "GET", url: "/alerts?limit=2" });
    const firstBody = first.json() as { items: unknown[]; nextCursor?: string };
    expect(firstBody.items.length).toBe(2);
    expect(firstBody.nextCursor).toBeTruthy();
    const second = await app.inject({
      method: "GET",
      url: `/alerts?limit=2&cursor=${firstBody.nextCursor}`,
    });
    const secondBody = second.json() as { items: unknown[]; nextCursor?: string };
    expect(secondBody.items.length).toBe(2);
    expect(secondBody.nextCursor).toBeUndefined();
  });

  it("GET /alerts/:id retorna o detalhe (AlertView)", async () => {
    const res = await app.inject({ method: "GET", url: `/alerts/${groomingId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversationId: string; signals: unknown[] };
    expect(body.conversationId).toBe("conv-demo-grooming");
    expect(body.signals.length).toBeGreaterThan(0);
  });

  it("GET /alerts/:id responde 400 para id malformado e 404 para inexistente", async () => {
    const bad = await app.inject({ method: "GET", url: "/alerts/!!!" });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: "GET",
      url: `/alerts/${encodeAlertId("nao-existe", "2026-01-01T00:00:00.000Z")}`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("POST /alerts/:id/feedback grava e valida o body", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/alerts/${groomingId}/feedback`,
      payload: { verdict: "useful", note: "confere" },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ verdict: "useful", conversationId: "conv-demo-grooming" });

    const invalid = await app.inject({
      method: "POST",
      url: `/alerts/${groomingId}/feedback`,
      payload: { verdict: "talvez" },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: `/alerts/${encodeAlertId("nao-existe", "2026-01-01T00:00:00.000Z")}/feedback`,
      payload: { verdict: "useful" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /settings retorna default e PUT persiste", async () => {
    const get = await app.inject({ method: "GET", url: "/settings" });
    expect(get.statusCode).toBe(200);
    const settings = get.json() as { sections: Array<{ id: string; items: unknown[] }> };
    expect(settings.sections.length).toBeGreaterThan(0);

    settings.sections[0]!.items = [];
    const put = await app.inject({ method: "PUT", url: "/settings", payload: settings });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: "/settings" });
    expect((after.json() as typeof settings).sections[0]!.items.length).toBe(0);
  });

  it("PUT /settings rejeita body inválido", async () => {
    const res = await app.inject({ method: "PUT", url: "/settings", payload: { foo: 1 } });
    expect(res.statusCode).toBe(400);
  });
});

describe("HTTP (auth por x-api-key)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = makeServer({ GUARDIAN_API_KEY: "segredo-demo" });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("/health continua público", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });

  it("bloqueia sem a chave", async () => {
    const res = await app.inject({ method: "GET", url: "/alerts" });
    expect(res.statusCode).toBe(401);
  });

  it("permite com a chave correta", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/alerts",
      headers: { "x-api-key": "segredo-demo" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejeita chave incorreta", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/alerts",
      headers: { "x-api-key": "errada" },
    });
    expect(res.statusCode).toBe(401);
  });
});

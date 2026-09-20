import { beforeEach, describe, expect, it } from "vitest";
import { MockRiskAnalyzer } from "../src/analyzer/mockAnalyzer.js";
import { loadConfig } from "../src/config/env.js";
import { createServer } from "../src/http/server.js";
import { demoConversations } from "../src/ingestion/fixtures.js";
import { MemoryBatchStore } from "../src/batch/MemoryBatchStore.js";
import { BatchScheduler } from "../src/batch/scheduler.js";
import { MemoryAlertStore } from "../src/store/AlertStore.js";
import { FeedbackStore, SettingsStore } from "../src/store/settings.js";

async function buildApp(env: NodeJS.ProcessEnv = {}) {
  const analyzer = new MockRiskAnalyzer({ now: () => new Date("2026-09-14T12:00:00.000Z") });
  const alerts = new MemoryAlertStore();
  const scheduler = new BatchScheduler({
    analyzer,
    alerts,
    batches: new MemoryBatchStore(),
    intervalMs: 60_000,
    contextBatches: 3,
    cooldownMs: 0,
  });

  // Alimenta o scheduler como a fonte faria e fecha o batch na mão.
  for (const conversation of demoConversations) {
    for (const message of conversation.messages) {
      scheduler.accept({
        conversationId: conversation.id,
        childName: conversation.childName,
        contactName: conversation.contactName,
        message,
      });
    }
  }
  await scheduler.tick();

  const app = createServer(loadConfig({ LOG_LEVEL: "error", ...env }), {
    alerts,
    feedback: new FeedbackStore(),
    settings: new SettingsStore(),
    scheduler,
    ingestion: "fixtures",
    analyzer: analyzer.name,
  });
  await app.ready();
  return app;
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  app = await buildApp();
});

describe("GET /alerts", () => {
  it("devolve a lista na forma que a tela consome", async () => {
    const response = await app.inject({ method: "GET", url: "/alerts" });
    expect(response.statusCode).toBe(200);

    const items = response.json();
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("child");
      expect(item).toHaveProperty("time");
      expect(["alta", "media", "baixa"]).toContain(item.priority);
      expect(typeof item.read).toBe("boolean");
      expect(item).toHaveProperty("category");
    }
  });

  it("descarta a conversa inofensiva", async () => {
    const items = (await app.inject({ method: "GET", url: "/alerts" })).json();
    expect(items.length).toBe(demoConversations.length - 1);
  });
});

describe("GET /alerts/:id", () => {
  it("devolve o detalhe com análise, nome e horário", async () => {
    const items = (await app.inject({ method: "GET", url: "/alerts" })).json();
    const response = await app.inject({ method: "GET", url: `/alerts/${items[0].id}` });
    expect(response.statusCode).toBe(200);

    const detail = response.json();
    expect(detail.childName).toBeTruthy();
    expect(detail.detectedTime).toBeTruthy();
    expect(detail.analysis.assessment.categories.length).toBeGreaterThan(0);
    expect(detail.analysis.explanation.recommendedActions.length).toBeGreaterThan(0);
  });

  it("RF-16: o detalhe não devolve nenhum texto das conversas", async () => {
    const items = (await app.inject({ method: "GET", url: "/alerts" })).json();

    for (const item of items) {
      const body = (await app.inject({ method: "GET", url: `/alerts/${item.id}` })).body;
      for (const conversation of demoConversations) {
        for (const message of conversation.messages) {
          expect(body).not.toContain(message.text);
        }
        expect(body).not.toContain(conversation.contactName);
      }
    }
  });

  it("marca como lido ao abrir", async () => {
    const before = (await app.inject({ method: "GET", url: "/alerts" })).json();
    expect(before[0].read).toBe(false);

    await app.inject({ method: "GET", url: `/alerts/${before[0].id}` });

    const after = (await app.inject({ method: "GET", url: "/alerts" })).json();
    expect(after.find((a: { id: string }) => a.id === before[0].id).read).toBe(true);
  });

  it("400 para id malformado e 404 para inexistente", async () => {
    expect((await app.inject({ method: "GET", url: "/alerts/!!!" })).statusCode).toBe(400);

    const missing = Buffer.from("nao-existe|2026-01-01T00:00:00.000Z", "utf-8").toString(
      "base64url",
    );
    expect((await app.inject({ method: "GET", url: `/alerts/${missing}` })).statusCode).toBe(404);
  });
});

describe("GET /dashboard", () => {
  it("devolve estatísticas, série de atividade e recentes", async () => {
    const payload = (await app.inject({ method: "GET", url: "/dashboard" })).json();

    expect(payload.stats).toHaveLength(4);
    expect(payload.activity).toHaveLength(7);
    expect(payload.recentAlerts.length).toBeGreaterThan(0);

    for (const stat of payload.stats) {
      expect(stat).toHaveProperty("label");
      expect(stat).toHaveProperty("value");
      expect(stat).toHaveProperty("hint");
    }
  });
});

describe("feedback e settings", () => {
  it("aceita feedback válido e rejeita veredito desconhecido", async () => {
    const items = (await app.inject({ method: "GET", url: "/alerts" })).json();

    const ok = await app.inject({
      method: "POST",
      url: `/alerts/${items[0].id}/feedback`,
      payload: { verdict: "useful", note: "conferi com minha filha" },
    });
    expect(ok.statusCode).toBe(201);

    const bad = await app.inject({
      method: "POST",
      url: `/alerts/${items[0].id}/feedback`,
      payload: { verdict: "talvez" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("devolve as seções padrão e persiste alteração", async () => {
    const settings = (await app.inject({ method: "GET", url: "/settings" })).json();
    expect(settings.sections.map((s: { id: string }) => s.id)).toEqual([
      "protecao",
      "privacidade",
      "responsavel",
    ]);

    settings.sections[0].items[0].enabled = false;
    const saved = await app.inject({ method: "PUT", url: "/settings", payload: settings });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().sections[0].items[0].enabled).toBe(false);

    const again = (await app.inject({ method: "GET", url: "/settings" })).json();
    expect(again.sections[0].items[0].enabled).toBe(false);
  });

  it("rejeita settings fora do formato", async () => {
    const bad = await app.inject({ method: "PUT", url: "/settings", payload: { sections: "não" } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("chave de API", () => {
  it("quando definida, exige x-api-key exceto no /health", async () => {
    const guarded = await buildApp({ GUARDIAN_API_KEY: "segredo-da-demo" });

    expect((await guarded.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await guarded.inject({ method: "GET", url: "/alerts" })).statusCode).toBe(401);

    const authorized = await guarded.inject({
      method: "GET",
      url: "/alerts",
      headers: { "x-api-key": "segredo-da-demo" },
    });
    expect(authorized.statusCode).toBe(200);
  });
});

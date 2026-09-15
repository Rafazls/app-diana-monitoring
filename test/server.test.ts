import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { MockRiskAnalyzer } from "../src/analyzer/mockAnalyzer.js";
import { ServerRiskAnalyzer } from "../src/analyzer/serverAnalyzer.js";
import type { Conversation } from "../src/contracts/index.js";

const conversation: Conversation = {
  id: "c1",
  childId: "k",
  childName: "Lucas",
  contactId: "o",
  contactName: "Bruno",
  startedAt: "2026-09-14T10:00:00.000Z",
  messages: [
    { id: "M1", author: "other", text: "nosso segredo", timestamp: "2026-09-14T10:00:00.000Z" },
    { id: "M2", author: "other", text: "manda uma foto sua", timestamp: "2026-09-14T10:01:00.000Z" },
  ],
};

let server: http.Server | null = null;

/** Servidor que imita a API de chat completions. */
async function fakeServer(
  handler: (n: number) => { status?: number; body?: unknown },
): Promise<{ url: string; corpos: unknown[] }> {
  const corpos: unknown[] = [];
  let n = 0;

  server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    corpos.push(JSON.parse(raw || "{}"));

    n += 1;
    const { status = 200, body = {} } = handler(n);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });

  await new Promise<void>((r) => server!.listen(0, r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, corpos };
}

const respostaOk = (json: string) => ({ body: { choices: [{ message: { content: json } }] } });

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
});

describe("ServerRiskAnalyzer", () => {
  it("envia system + user e aproveita a resposta do modelo", async () => {
    const { url, corpos } = await fakeServer(() =>
      respostaOk('{"signals":[{"type":"image_request","messageIds":["M2"],"confidence":0.9,"severity":"high"}]}'),
    );

    const r = await new ServerRiskAnalyzer({ baseUrl: url, model: "qwen2.5:3b" }).analyze(conversation);

    const enviado = corpos[0] as { model: string; messages: Array<{ role: string; content: string }>; temperature: number };
    expect(enviado.model).toBe("qwen2.5:3b");
    expect(enviado.messages[0]?.role).toBe("system");
    expect(enviado.messages[1]?.content).toContain("[M1]");
    // Determinismo: o mesmo texto precisa dar o mesmo veredito.
    expect(enviado.temperature).toBe(0);

    expect(r.model.modelName).toBe("server:qwen2.5:3b");
    expect(r.signals.map((s) => s.type)).toContain("image_request");
  });

  it("aceita URL com barra no fim, sem virar // na rota", async () => {
    const { url } = await fakeServer(() => respostaOk('{"signals":[]}'));
    const r = await new ServerRiskAnalyzer({ baseUrl: `${url}/`, model: "m" }).analyze(conversation);
    expect(r.assessment.score).toBe(0);
  });

  it("repete quando o servidor ainda está subindo (503) e segue depois", async () => {
    const { url } = await fakeServer((n) =>
      n < 3
        ? { status: 503, body: { error: { message: "loading model" } } }
        : respostaOk('{"signals":[{"type":"secrecy_request","messageIds":["M1"],"confidence":0.8,"severity":"medium"}]}'),
    );

    const r = await new ServerRiskAnalyzer({ baseUrl: url, model: "m", maxRetries: 3 }).analyze(conversation);

    expect(r.model.modelName).toContain("server:");
    expect(r.audit.some((e) => e.description.includes("repetição"))).toBe(true);
  }, 20_000);

  it("cai para a heurística se o servidor não responde, sem perder a conversa", async () => {
    const r = await new ServerRiskAnalyzer({
      // Porta onde não há nada ouvindo.
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      maxRetries: 0,
      fallback: new MockRiskAnalyzer(),
    }).analyze(conversation);

    expect(r.model.environment).toBe("mock");
    expect(r.signals.length).toBeGreaterThan(0);
  }, 20_000);

  it("descarta sinal que cita mensagem inexistente", async () => {
    const { url } = await fakeServer(() =>
      respostaOk('{"signals":[{"type":"threat","messageIds":["M99"],"confidence":0.9,"severity":"high"}]}'),
    );
    const r = await new ServerRiskAnalyzer({ baseUrl: url, model: "m" }).analyze(conversation);
    expect(r.signals).toHaveLength(0);
  });

  it("exige URL e nome do modelo", () => {
    expect(() => new ServerRiskAnalyzer({ baseUrl: "", model: "m" })).toThrow(/MODEL_SERVER_URL/);
    expect(() => new ServerRiskAnalyzer({ baseUrl: "http://x/v1", model: "" })).toThrow(/MODEL_SERVER_MODEL/);
  });
});

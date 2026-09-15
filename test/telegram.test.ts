import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "../src/batch/scheduler.js";
import { TelegramSource } from "../src/ingestion/TelegramSource.js";

/**
 * Bot API falsa: entrega updates enfileirados e registra os offsets pedidos.
 * Exercita o código real de ingestão sem depender do Telegram.
 */
function fakeTelegram() {
  const queue: unknown[] = [];
  const offsets: number[] = [];
  let nextId = 1;

  const server = http.createServer(async (req, res) => {
    const method = (req.url ?? "").split("/").pop() ?? "";
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = body ? (JSON.parse(body) as { offset?: number }) : {};

    const send = (result: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
    };

    if (method === "getMe") return send({ username: "sim_bot" });

    if (method === "getUpdates") {
      const offset = Number(payload.offset ?? 0);
      offsets.push(offset);
      const ready = (queue as Array<{ update_id: number }>).filter((u) => u.update_id >= offset);
      // Responde na hora (sem long polling) para o teste não esperar.
      return send(ready);
    }

    return send(true);
  });

  return {
    server,
    offsets,
    say(fromId: number, firstName: string, text: string) {
      queue.push({
        update_id: nextId++,
        message: {
          message_id: nextId,
          date: Math.floor(Date.now() / 1000),
          text,
          from: { id: fromId, is_bot: false, first_name: firstName },
          chat: { id: -100, type: "group", title: "Conversa" },
        },
      });
    },
    async listen(): Promise<string> {
      await new Promise<void>((resolve) => server.listen(0, resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const CHILD_ID = 111;
const OTHER_ID = 222;

let fake: ReturnType<typeof fakeTelegram>;
let source: TelegramSource | null = null;

beforeEach(() => {
  fake = fakeTelegram();
});

afterEach(async () => {
  await source?.stop();
  source = null;
  await fake.close();
});

/**
 * Sobe a fonte e coleta as mensagens entregues até o fluxo cessar.
 * A fonte não agrupa mais — quem agrupa é o scheduler — então o teste junta.
 */
async function collect(apiBase: string, esperadas: number, childId?: number): Promise<IncomingMessage[]> {
  const recebidas: IncomingMessage[] = [];

  source = new TelegramSource({
    token: "teste",
    ...(childId !== undefined ? { childTelegramId: String(childId) } : {}),
    childName: "Lucas",
    apiBase,
  });

  await source.start((m) => recebidas.push(m));

  const limite = Date.now() + 5000;
  while (recebidas.length < esperadas && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return recebidas;
}

describe("TelegramSource", () => {
  it("marca como criança só quem tem o id configurado", async () => {
    fake.say(OTHER_ID, "Bruno", "oi, tudo bem?");
    fake.say(CHILD_ID, "Lucas", "oi!");
    fake.say(OTHER_ID, "Bruno", "nosso segredo");

    const recebidas = await collect(await fake.listen(), 3, CHILD_ID);

    expect(recebidas.map((m) => m.message.author)).toEqual(["other", "child", "other"]);
    expect(recebidas[0]?.childName).toBe("Lucas");
    // O contato é o primeiro remetente que não é a criança.
    expect(recebidas[0]?.contactName).toBe("Bruno");
  });

  it("entrega as mensagens do chat na ordem, com o mesmo id de conversa", async () => {
    fake.say(OTHER_ID, "Bruno", "primeira");
    fake.say(CHILD_ID, "Lucas", "segunda");
    fake.say(OTHER_ID, "Bruno", "terceira");

    const recebidas = await collect(await fake.listen(), 3, CHILD_ID);

    expect(recebidas.map((m) => m.message.text)).toEqual(["primeira", "segunda", "terceira"]);
    expect(new Set(recebidas.map((m) => m.conversationId))).toEqual(new Set(["tg--100"]));
  });

  it("avança o offset para não reprocessar o que já leu", async () => {
    fake.say(OTHER_ID, "Bruno", "oi");
    fake.say(CHILD_ID, "Lucas", "oi!");

    await collect(await fake.listen(), 2, CHILD_ID);
    await new Promise((r) => setTimeout(r, 120));

    // O primeiro pedido começa em 0; depois de ler 2 updates, avança.
    expect(fake.offsets[0]).toBe(0);
    expect(Math.max(...fake.offsets)).toBeGreaterThan(0);
  });

  it("sem TELEGRAM_CHILD_ID, ninguém é marcado como criança", async () => {
    fake.say(CHILD_ID, "Lucas", "oi");

    const recebidas = await collect(await fake.listen(), 1);

    // Documenta a consequência: padrões que só contam vindos do interlocutor
    // passam a contar para tudo, e a análise perde sentido.
    expect(recebidas[0]?.message.author).toBe("other");
  });

  it("exige token", () => {
    expect(() => new TelegramSource({ token: "", childName: "Lucas" })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});

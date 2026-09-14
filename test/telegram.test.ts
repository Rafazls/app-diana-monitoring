import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Conversation } from "../src/contracts/index.js";
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

/** Sobe a fonte e espera a primeira conversa fechar a janela. */
async function collectFirst(apiBase: string, idleMs = 150): Promise<Conversation> {
  return new Promise<Conversation>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("nenhuma conversa foi entregue")), 5000);

    source = new TelegramSource({
      token: "teste",
      childTelegramId: String(CHILD_ID),
      childName: "Lucas",
      apiBase,
      idleMs,
    });

    void source.start(async (conversation) => {
      clearTimeout(timer);
      resolve(conversation);
    });
  });
}

describe("TelegramSource", () => {
  it("marca como criança só quem tem o id configurado", async () => {
    fake.say(OTHER_ID, "Bruno", "oi, tudo bem?");
    fake.say(CHILD_ID, "Lucas", "oi!");
    fake.say(OTHER_ID, "Bruno", "nosso segredo");

    const conversation = await collectFirst(await fake.listen());

    expect(conversation.messages.map((m) => m.author)).toEqual(["other", "child", "other"]);
    expect(conversation.childName).toBe("Lucas");
    // O contato é o primeiro remetente que não é a criança.
    expect(conversation.contactName).toBe("Bruno");
  });

  it("agrupa as mensagens do chat numa conversa só, na ordem", async () => {
    fake.say(OTHER_ID, "Bruno", "primeira");
    fake.say(CHILD_ID, "Lucas", "segunda");
    fake.say(OTHER_ID, "Bruno", "terceira");

    const conversation = await collectFirst(await fake.listen());

    expect(conversation.messages.map((m) => m.text)).toEqual(["primeira", "segunda", "terceira"]);
    expect(conversation.id).toBe("tg--100");
  });

  it("avança o offset para não reprocessar o que já leu", async () => {
    fake.say(OTHER_ID, "Bruno", "oi");
    fake.say(CHILD_ID, "Lucas", "oi!");

    await collectFirst(await fake.listen());
    await new Promise((r) => setTimeout(r, 120));

    // O primeiro pedido começa em 0; depois de ler 2 updates, avança.
    expect(fake.offsets[0]).toBe(0);
    expect(Math.max(...fake.offsets)).toBeGreaterThan(0);
  });

  it("sem TELEGRAM_CHILD_ID, ninguém é marcado como criança", async () => {
    fake.say(CHILD_ID, "Lucas", "oi");
    const apiBase = await fake.listen();

    const conversation = await new Promise<Conversation>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("sem conversa")), 5000);
      source = new TelegramSource({
        token: "teste",
        childName: "Lucas",
        apiBase,
        idleMs: 150,
      });
      void source.start(async (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });

    // Documenta a consequência: padrões que só contam vindos do interlocutor
    // passam a contar para tudo, e a análise perde sentido.
    expect(conversation.messages[0]?.author).toBe("other");
  });

  it("exige token", () => {
    expect(() => new TelegramSource({ token: "", childName: "Lucas" })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { MockRiskAnalyzer } from "../src/analyzer/mockAnalyzer.js";
import { MemoryBatchStore } from "../src/batch/MemoryBatchStore.js";
import { BatchScheduler, type IncomingMessage } from "../src/batch/scheduler.js";
import { MemoryAlertStore } from "../src/store/AlertStore.js";

let batches: MemoryBatchStore;
let alerts: MemoryAlertStore;
let scheduler: BatchScheduler;

function build(contextBatches = 3) {
  batches = new MemoryBatchStore();
  alerts = new MemoryAlertStore();
  scheduler = new BatchScheduler({
    analyzer: new MockRiskAnalyzer({ now: () => new Date("2026-09-14T12:00:00.000Z") }),
    batches,
    alerts,
    intervalMs: 60_000, // o teste dispara o tick à mão
    contextBatches,
  });
}

function msg(text: string, author: "child" | "other" = "other", id = text): IncomingMessage {
  return {
    conversationId: "conv-1",
    childName: "Lucas",
    contactName: "Bruno",
    message: { id, author, text, timestamp: new Date().toISOString() },
  };
}

beforeEach(() => build());

describe("BatchScheduler", () => {
  it("não cria batch quando não chegou mensagem nova", async () => {
    await scheduler.tick();
    expect(scheduler.getStats().batches).toBe(0);
    expect(scheduler.getStats().analyzed).toBe(0);
  });

  it("fecha um batch com o que chegou e persiste antes de analisar", async () => {
    scheduler.accept(msg("oi", "other", "m1"));
    scheduler.accept(msg("oi!", "child", "m2"));
    await scheduler.tick();

    const salvos = await batches.recent("conv-1", 10);
    expect(salvos).toHaveLength(1);
    expect(salvos[0]?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(scheduler.getStats().batches).toBe(1);
  });

  it("esvazia o pendente: o mesmo batch não é reprocessado", async () => {
    scheduler.accept(msg("oi", "other", "m1"));
    await scheduler.tick();
    await scheduler.tick();

    expect(await batches.recent("conv-1", 10)).toHaveLength(1);
    expect(scheduler.getStats().batches).toBe(1);
  });

  it("analisa com a janela dos últimos N batches, não só o atual", async () => {
    // Sozinho, "nosso segredo" fica abaixo do limiar e não alerta.
    scheduler.accept(msg("fica entre a gente, nosso segredo", "other", "m1"));
    await scheduler.tick();
    expect(scheduler.getStats().alerted).toBe(0);

    // O segundo batch soma contexto ao primeiro e cruza o limiar.
    scheduler.accept(msg("manda uma foto sua", "other", "m2"));
    await scheduler.tick();

    expect(scheduler.getStats().alerted).toBe(1);
    const lista = await alerts.list();
    // Os dois sinais aparecem, prova de que o contexto anterior entrou.
    const tipos = lista[0]?.result.signals.map((s) => s.type) ?? [];
    expect(tipos).toContain("secrecy_request");
    expect(tipos).toContain("image_request");
  });

  it("respeita o limite da janela e esquece batches antigos", async () => {
    build(2); // só os 2 últimos batches entram no contexto

    scheduler.accept(msg("nosso segredo", "other", "m1"));
    await scheduler.tick();
    scheduler.accept(msg("oi tudo bem", "other", "m2"));
    await scheduler.tick();
    scheduler.accept(msg("bom dia", "other", "m3"));
    await scheduler.tick();

    const janela = await batches.recent("conv-1", 2);
    const ids = janela.flatMap((b) => b.messages.map((m) => m.id));
    expect(ids).toEqual(["m2", "m3"]);
    expect(ids).not.toContain("m1");
  });

  it("descarta conversa sem risco em vez de alertar", async () => {
    scheduler.accept(msg("oi, tudo bem?", "other", "m1"));
    scheduler.accept(msg("tudo!", "child", "m2"));
    await scheduler.tick();

    expect(scheduler.getStats().discarded).toBe(1);
    expect(scheduler.getStats().alerted).toBe(0);
    expect(await alerts.list()).toHaveLength(0);
  });

  it("separa conversas diferentes em batches distintos", async () => {
    scheduler.accept(msg("oi", "other", "a1"));
    scheduler.accept({ ...msg("oi", "other", "b1"), conversationId: "conv-2" });
    await scheduler.tick();

    expect(await batches.recent("conv-1", 10)).toHaveLength(1);
    expect(await batches.recent("conv-2", 10)).toHaveLength(1);
    expect(scheduler.getStats().batches).toBe(2);
  });

  it("stop() fecha o batch pendente para não perder mensagem", async () => {
    scheduler.accept(msg("nosso segredo", "other", "m1"));
    await scheduler.stop();

    expect(await batches.recent("conv-1", 10)).toHaveLength(1);
  });
});

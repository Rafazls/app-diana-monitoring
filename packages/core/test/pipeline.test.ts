import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockRiskAnalyzer } from "@diana/analyzer";
import { parseAlertRecord } from "@diana/contracts";
import { FileAlertStore, safeId } from "../src/alertStore.js";
import { demoConversations } from "../src/fixtures/conversations.js";
import { runPipeline } from "../src/pipeline.js";

let stateDir: string;

beforeEach(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "diana-core-"));
});

afterEach(async () => {
  await fs.rm(stateDir, { recursive: true, force: true });
});

async function run() {
  return runPipeline({
    conversations: demoConversations,
    analyzer: new MockRiskAnalyzer({ now: () => new Date("2026-09-14T12:00:00.000Z") }),
    store: new FileAlertStore(stateDir),
  });
}

describe("pipeline", () => {
  it("alerta sobre as conversas de risco e descarta a inofensiva", async () => {
    const result = await run();

    expect(result.analyzed).toBe(demoConversations.length);
    expect(result.alerted).toBeGreaterThan(0);
    expect(result.discarded).toBeGreaterThan(0);

    const benign = result.outcomes.find((o) => o.conversationId === "conv-benign-01");
    expect(benign?.alerted).toBe(false);
    expect(benign?.score).toBe(0);
  });

  it("grava no layout que a guardian-api sabe ler", async () => {
    const result = await run();
    const alerted = result.outcomes.filter((o) => o.alerted);

    for (const outcome of alerted) {
      const dir = path.join(stateDir, "alerts", safeId(outcome.conversationId));
      const files = await fs.readdir(dir);
      expect(files.some((file) => file.endsWith(".json"))).toBe(true);
    }
  });

  it("cada arquivo gravado é um AlertRecord válido pelo contrato", async () => {
    await run();

    const alertsDir = path.join(stateDir, "alerts");
    const dirs = await fs.readdir(alertsDir);
    expect(dirs.length).toBeGreaterThan(0);

    for (const dir of dirs) {
      for (const file of await fs.readdir(path.join(alertsDir, dir))) {
        const raw: unknown = JSON.parse(await fs.readFile(path.join(alertsDir, dir, file), "utf-8"));
        const parsed = parseAlertRecord(raw);
        expect(parsed.ok, `registro inválido em ${dir}/${file}`).toBe(true);
      }
    }
  });

  it("grava o índice de nomes apenas das conversas que viraram alerta", async () => {
    const result = await run();

    const index: Record<string, string> = JSON.parse(
      await fs.readFile(path.join(stateDir, "children.json"), "utf-8"),
    );

    const alertedIds = result.outcomes.filter((o) => o.alerted).map((o) => o.conversationId);
    expect(Object.keys(index).sort()).toEqual(alertedIds.sort());
    expect(index["conv-benign-01"]).toBeUndefined();
  });

  it("é reproduzível: rodar duas vezes não acumula alertas", async () => {
    const first = await run();
    const second = await run();

    expect(second.alerted).toBe(first.alerted);

    const dirs = await fs.readdir(path.join(stateDir, "alerts"));
    expect(dirs).toHaveLength(first.alerted);
  });
});

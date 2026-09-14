import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "../src/config/env.js";
import type { AlertRecord } from "../src/contracts/index.js";
import { buildServer } from "../src/http/server.js";
import type { AppDeps } from "../src/http/deps.js";
import type { AlertReader } from "../src/sources/AlertReader.js";
import { FileAlertReader } from "../src/sources/FileAlertReader.js";
import { demoAlertRecords } from "../src/sources/fixtures/demoAlerts.js";
import { MemoryFeedbackStore } from "../src/store/FeedbackStore.js";
import { MemorySettingsStore } from "../src/store/SettingsStore.js";

function depsWithReader(reader: AlertReader): AppDeps {
  return {
    config: loadConfig({ ALERTS_SOURCE: "fixtures" }),
    reader,
    feedbackStore: new MemoryFeedbackStore(),
    settingsStore: new MemorySettingsStore(),
  };
}

// ---------------------------------------------------------------------------
// Finding C — validação de schema na leitura (FileAlertReader)
// ---------------------------------------------------------------------------
describe("FileAlertReader — validação de schema (§10)", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function makeStateDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guardian-file-"));
    tmpDirs.push(dir);
    return dir;
  }

  async function writeAlert(stateDir: string, conversationId: string, record: unknown) {
    const dir = path.join(stateDir, "alerts", conversationId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "ts.json"), JSON.stringify(record), "utf-8");
  }

  it("serve registros válidos e IGNORA malformados (lista)", async () => {
    const stateDir = await makeStateDir();
    const valid = demoAlertRecords()[0]!;
    await writeAlert(stateDir, "ok", valid);
    await writeAlert(stateDir, "bad-json", "{{{ não é json");
    await writeAlert(stateDir, "bad-shape", { conversationId: "x", processedAt: "y" }); // sem result
    await writeAlert(stateDir, "bad-priority", {
      ...valid,
      conversationId: "bad-priority",
      result: { ...valid.result, assessment: { ...valid.result.assessment, priority: "critical" } },
    });

    const reader = new FileAlertReader(stateDir);
    const list = await reader.listAlerts();
    expect(list.length).toBe(1);
    expect(list[0]!.conversationId).toBe(valid.conversationId);
  });

  it("getAlert devolve null para registro fora do contrato", async () => {
    const stateDir = await makeStateDir();
    await writeAlert(stateDir, "bad-shape", { foo: 1 });
    const reader = new FileAlertReader(stateDir);
    expect(await reader.getAlert("bad-shape", "ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Finding B — GET /alerts robusto
// ---------------------------------------------------------------------------
describe("GET /alerts — robustez", () => {
  async function withServer(reader: AlertReader, fn: (app: FastifyInstance) => Promise<void>) {
    const app = buildServer(depsWithReader(reader));
    await app.ready();
    try {
      await fn(app);
    } finally {
      await app.close();
    }
  }

  it("responde 503 quando a fonte falha (I/O)", async () => {
    const failing: AlertReader = {
      listAlerts: () => Promise.reject(new Error("disco indisponível")),
      getAlert: () => Promise.reject(new Error("disco indisponível")),
    };
    await withServer(failing, async (app) => {
      const res = await app.inject({ method: "GET", url: "/alerts" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: "source_unavailable" });
    });
  });

  it("pula item problemático e serve os demais (não é tudo-ou-nada)", async () => {
    const good = demoAlertRecords()[0]!;
    // conversationId com "|" faz encodeAlertId lançar dentro da projeção.
    const bad: AlertRecord = { ...good, conversationId: "conv|ruim" };
    const partial: AlertReader = {
      listAlerts: () => Promise.resolve([good, bad]),
      getAlert: () => Promise.resolve(null),
    };
    await withServer(partial, async (app) => {
      const res = await app.inject({ method: "GET", url: "/alerts" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { items: unknown[] };
      expect(body.items.length).toBe(1);
    });
  });

  it("responde 400 para cursor inválido", async () => {
    const reader: AlertReader = {
      listAlerts: () => Promise.resolve(demoAlertRecords()),
      getAlert: () => Promise.resolve(null),
    };
    await withServer(reader, async (app) => {
      const res = await app.inject({ method: "GET", url: "/alerts?cursor=xyz-invalido" });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "bad_request" });
    });
  });

  it("responde 503 no detalhe quando a fonte falha", async () => {
    const failing: AlertReader = {
      listAlerts: () => Promise.resolve([]),
      getAlert: () => Promise.reject(new Error("disco indisponível")),
    };
    await withServer(failing, async (app) => {
      // id bem-formado para chegar ao getAlert.
      const id = Buffer.from("c|2026-01-01T00:00:00.000Z", "utf-8").toString("base64url");
      const res = await app.inject({ method: "GET", url: `/alerts/${id}` });
      expect(res.statusCode).toBe(503);
    });
  });
});

// ---------------------------------------------------------------------------
// OCI reader — fail-fast no construtor
// ---------------------------------------------------------------------------
describe("OCI reader — fail-fast", () => {
  it("lança ao construir (boot), não só na leitura", async () => {
    const { OciObjectStorageAlertReader } =
      await import("../src/sources/OciObjectStorageAlertReader.js");
    expect(
      () => new OciObjectStorageAlertReader({ bucket: "b", namespace: "n", region: "r" }),
    ).toThrow(/oci/i);
  });
});

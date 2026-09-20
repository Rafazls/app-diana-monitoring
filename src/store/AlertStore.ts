import { promises as fs } from "node:fs";
import path from "node:path";
import type { AlertRecord, AnalysisResult } from "../contracts/index.js";
import { parseAlertRecord } from "../contracts/index.js";
import { logger } from "../logger.js";
import { BaseAlertStore } from "./BaseAlertStore.js";
import { OracleAlertStore } from "./OracleAlertStore.js";

export interface AlertStore {
  save(result: AnalysisResult, childName: string): Promise<AlertRecord>;
  list(): Promise<AlertRecord[]>;
  get(conversationId: string, processedAt: string): Promise<AlertRecord | null>;
  /** ISO do alerta mais recente desta conversa, ou null se nunca alertou. */
  latestAlertAt(conversationId: string): Promise<string | null>;
  /** Nome da criança de uma conversa — vive fora do payload de análise. */
  childName(conversationId: string): string | undefined;
  markRead(conversationId: string, processedAt: string): void;
  isRead(conversationId: string, processedAt: string): boolean;
}

/** Sanitiza um id para virar nome de arquivo/pasta. */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toRecord(result: AnalysisResult): AlertRecord {
  return {
    conversationId: result.conversationId,
    processedAt: result.processedAt,
    result,
  };
}

/** Estado comum: nomes e marcação de lido, que não pertencem ao AlertRecord. */

export class MemoryAlertStore extends BaseAlertStore implements AlertStore {
  // Chave composta (conversationId|processedAt): cada análise vira um
  // registro de histórico próprio, em vez de substituir o anterior.
  private readonly records = new Map<string, AlertRecord>();

  async save(result: AnalysisResult, childName: string): Promise<AlertRecord> {
    const record = toRecord(result);
    this.records.set(this.key(record.conversationId, record.processedAt), record);
    this.names.set(record.conversationId, childName);
    return record;
  }

  async list(): Promise<AlertRecord[]> {
    return [...this.records.values()];
  }

  async get(conversationId: string, processedAt: string): Promise<AlertRecord | null> {
    return this.records.get(this.key(conversationId, processedAt)) ?? null;
  }

  async latestAlertAt(conversationId: string): Promise<string | null> {
    let latest: string | null = null;
    for (const record of this.records.values()) {
      if (record.conversationId !== conversationId) continue;
      if (!latest || record.processedAt > latest) latest = record.processedAt;
    }
    return latest;
  }
}

export class FileAlertStore extends BaseAlertStore implements AlertStore {
  private readonly alertsDir: string;
  private readonly namesFile: string;

  constructor(private readonly stateDir: string) {
    super();
    this.alertsDir = path.join(stateDir, "alerts");
    this.namesFile = path.join(stateDir, "children.json");
    void this.loadNames();
  }

  private async loadNames(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.namesFile, "utf-8"));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        for (const [id, name] of Object.entries(parsed)) {
          if (typeof name === "string") this.names.set(id, name);
        }
      }
    } catch {
      // Sem índice ainda: os nomes aparecem conforme os alertas forem gravados.
    }
  }

  private async persistNames(): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const entries = Object.fromEntries(this.names);
    await fs.writeFile(this.namesFile, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
  }

  async save(result: AnalysisResult, childName: string): Promise<AlertRecord> {
    const record = toRecord(result);
    const dir = path.join(this.alertsDir, safeId(record.conversationId));

    // Cada processedAt vira um arquivo próprio: reanálise soma ao histórico
    // da conversa em vez de substituir a versão anterior.
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${safeId(record.processedAt)}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf-8",
    );

    this.names.set(record.conversationId, childName);
    await this.persistNames();
    return record;
  }

  async list(): Promise<AlertRecord[]> {
    let dirs: string[];
    try {
      const entries = await fs.readdir(this.alertsDir, { withFileTypes: true });
      dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }

    const records: AlertRecord[] = [];
    for (const dir of dirs) {
      const dirPath = path.join(this.alertsDir, dir);
      for (const file of await fs.readdir(dirPath)) {
        if (!file.endsWith(".json")) continue;
        const record = await this.readValidated(path.join(dirPath, file));
        if (record) records.push(record);
      }
    }
    return records;
  }

  async get(conversationId: string, processedAt: string): Promise<AlertRecord | null> {
    return this.readValidated(
      path.join(this.alertsDir, safeId(conversationId), `${safeId(processedAt)}.json`),
    );
  }

  async latestAlertAt(conversationId: string): Promise<string | null> {
    const dir = path.join(this.alertsDir, safeId(conversationId));
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      return null;
    }
    // Nome do arquivo é o processedAt sanitizado; ordenação lexicográfica de
    // ISO 8601 já é ordenação cronológica.
    const latest = files.map((f) => f.replace(/\.json$/, "")).sort().at(-1);
    return latest ?? null;
  }

  /**
   * Lê e valida contra o contrato. Registro malformado é logado e IGNORADO —
   * nunca propagado à borda, onde viraria uma tela quebrada.
   */
  private async readValidated(filePath: string): Promise<AlertRecord | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
    } catch {
      return null;
    }

    const parsed = parseAlertRecord(raw);
    if (!parsed.ok) {
      logger.warn(`Alerta fora do contrato em ${filePath} — ignorado (${parsed.error}).`);
      return null;
    }
    return parsed.record;
  }
}

export function createAlertStore(env: NodeJS.ProcessEnv = process.env): AlertStore {
  const backend = (env.STORE ?? "memory").toLowerCase();
  if (backend === "file") return new FileAlertStore(env.STATE_DIR ?? "./.state");
  if (backend === "memory") return new MemoryAlertStore();
  if (backend === "oracle") {
    return new OracleAlertStore({
      user: env.ORACLE_USER ?? "",
      password: env.ORACLE_PASSWORD ?? "",
      connectString: env.ORACLE_CONNECT_STRING ?? "",
      ...(env.ORACLE_WALLET_DIR ? { walletDir: env.ORACLE_WALLET_DIR } : {}),
      ...(env.ORACLE_WALLET_PASSWORD ? { walletPassword: env.ORACLE_WALLET_PASSWORD } : {}),
    });
  }
  throw new Error(`STORE inválido: "${backend}". Use "memory", "file" ou "oracle".`);
}

/** Lojas que precisam abrir e fechar conexão (hoje: Oracle). */
export function hasLifecycle(
  store: AlertStore,
): store is AlertStore & { init(): Promise<void>; close(): Promise<void> } {
  return typeof (store as { init?: unknown }).init === "function";
}

export { BaseAlertStore };

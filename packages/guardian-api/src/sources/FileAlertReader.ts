/**
 * DIANA guardian-api — leitor de alertas em DISCO (dev / integração local).
 *
 * Varre `STATE_DIR/alerts/<conversationId>/<processedAt>.json` — exatamente o
 * layout que o `FileStateStore` do núcleo grava (§5.1). Usado com
 * `ALERTS_SOURCE=file` para integrar com o núcleo rodando na mesma máquina.
 *
 * VALIDAÇÃO DE ENTRADA (§10): cada arquivo é validado contra o schema do
 * contrato (`parseAlertRecord`) antes de ser servido. Um registro malformado é
 * LOGADO e IGNORADO — nunca propagado à borda (evita servir dados fora do
 * contrato, ex.: `priority` inválida que `mapPriority` não conhece).
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import type { AlertRecord } from "../contracts/index.js";
import { parseAlertRecord } from "../contracts/schema.js";
import { logger } from "../logger.js";
import type { AlertReader } from "./AlertReader.js";

/** Sanitiza um id igual ao `safeId` do núcleo (para localizar o arquivo). */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Carrega o índice `conversationId -> childName` gravado pelo núcleo.
 * Ausente ou inválido => mapa vazio (a UI cai no fallback "Criança"): a falta
 * do nome nunca pode impedir o alerta de chegar ao responsável.
 */
function loadChildNames(filePath: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export class FileAlertReader implements AlertReader {
  private readonly alertsDir: string;
  private readonly childNames: Record<string, string>;

  constructor(stateDir: string) {
    this.alertsDir = path.join(stateDir, "alerts");
    this.childNames = loadChildNames(path.join(stateDir, "children.json"));
  }

  /**
   * O nome vem do índice que o núcleo grava ao lado dos alertas — nunca do
   * `AnalysisResult`, que de propósito não identifica a criança (§6.4).
   * Lido uma vez no boot: se o núcleo rodar de novo, reinicie a API.
   */
  resolveChildName(conversationId: string): string | undefined {
    return this.childNames[conversationId];
  }

  /** Lê + parseia JSON. `null` se o arquivo não existe. */
  private async readRaw(filePath: string): Promise<unknown | null> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      logger.warn(`FileAlertReader: JSON inválido em ${filePath} — ignorado.`);
      return null;
    }
  }

  /** Lê + valida contra o contrato. `null` se inexistente ou malformado. */
  private async readValidated(filePath: string): Promise<AlertRecord | null> {
    const raw = await this.readRaw(filePath);
    if (raw === null) return null;
    const parsed = parseAlertRecord(raw);
    if (!parsed.ok) {
      logger.warn(
        `FileAlertReader: registro fora do contrato em ${filePath} — ignorado (${parsed.error}).`,
      );
      return null;
    }
    return parsed.record;
  }

  async listAlerts(): Promise<AlertRecord[]> {
    let conversationDirs: string[];
    try {
      const entries = await fs.readdir(this.alertsDir, { withFileTypes: true });
      conversationDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const records: AlertRecord[] = [];
    for (const dir of conversationDirs) {
      const dirPath = path.join(this.alertsDir, dir);
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const record = await this.readValidated(path.join(dirPath, file));
        if (record) records.push(record);
      }
    }
    return records;
  }

  async getAlert(conversationId: string, processedAt: string): Promise<AlertRecord | null> {
    const filePath = path.join(
      this.alertsDir,
      safeId(conversationId),
      `${safeId(processedAt)}.json`,
    );
    return this.readValidated(filePath);
  }
}

/**
 * DIANA guardian-api — persistência de SETTINGS do responsável (§7.4).
 *
 * Backends: `memory` (default p/ demo) e `file` (grava em
 * `STATE_DIR/settings/guardian.json`). Documento único global no MVP.
 * `get` retorna o default quando ausente.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { guardianSettingsSchema } from "../domain/guardianSchemas.js";
import type { GuardianSettings } from "../domain/viewTypes.js";
import { logger } from "../logger.js";
import { defaultGuardianSettings } from "./defaultSettings.js";

export interface SettingsStore {
  get(): Promise<GuardianSettings>;
  put(settings: GuardianSettings): Promise<GuardianSettings>;
}

export class MemorySettingsStore implements SettingsStore {
  private current: GuardianSettings | null = null;

  async get(): Promise<GuardianSettings> {
    return this.current ? structuredClone(this.current) : defaultGuardianSettings();
  }

  async put(settings: GuardianSettings): Promise<GuardianSettings> {
    this.current = structuredClone(settings);
    return structuredClone(this.current);
  }
}

export class FileSettingsStore implements SettingsStore {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = path.join(stateDir, "settings", "guardian.json");
  }

  async get(): Promise<GuardianSettings> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return defaultGuardianSettings();
      throw err;
    }

    // Valida o documento lido contra o schema; se malformado, loga e devolve o
    // default (nunca serve settings fora do contrato).
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      logger.warn(`FileSettingsStore: JSON inválido em ${this.filePath} — usando default.`);
      return defaultGuardianSettings();
    }
    const parsed = guardianSettingsSchema.safeParse(value);
    if (!parsed.success) {
      logger.warn(
        `FileSettingsStore: settings fora do contrato em ${this.filePath} — usando default.`,
      );
      return defaultGuardianSettings();
    }
    return parsed.data;
  }

  async put(settings: GuardianSettings): Promise<GuardianSettings> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
    return structuredClone(settings);
  }
}

/**
 * DIANA guardian-api — persistência de FEEDBACK do responsável (§9).
 *
 * Backends: `memory` (default p/ demo) e `file` (grava em
 * `STATE_DIR/feedback/<conversationId>/<processedAt>.json` — prefixo novo, não
 * conflita com o núcleo). Idempotência: o último feedback por alerta prevalece
 * (sobrescreve).
 *
 * O backend `oci` é PR-11 (placeholder que falha explicitamente).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { feedbackRecordSchema } from "../domain/guardianSchemas.js";
import type { FeedbackRecord } from "../domain/viewTypes.js";
import { logger } from "../logger.js";

export interface FeedbackStore {
  save(record: FeedbackRecord): Promise<void>;
  get(conversationId: string, processedAt: string): Promise<FeedbackRecord | null>;
}

/** Sanitiza um id igual ao `safeId` do núcleo. */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class MemoryFeedbackStore implements FeedbackStore {
  private readonly byKey = new Map<string, FeedbackRecord>();

  private key(conversationId: string, processedAt: string): string {
    return `${conversationId}|${processedAt}`;
  }

  async save(record: FeedbackRecord): Promise<void> {
    this.byKey.set(this.key(record.conversationId, record.processedAt), { ...record });
  }

  async get(conversationId: string, processedAt: string): Promise<FeedbackRecord | null> {
    const found = this.byKey.get(this.key(conversationId, processedAt));
    return found ? { ...found } : null;
  }
}

export class FileFeedbackStore implements FeedbackStore {
  private readonly feedbackDir: string;

  constructor(stateDir: string) {
    this.feedbackDir = path.join(stateDir, "feedback");
  }

  private filePath(conversationId: string, processedAt: string): string {
    return path.join(this.feedbackDir, safeId(conversationId), `${safeId(processedAt)}.json`);
  }

  async save(record: FeedbackRecord): Promise<void> {
    const filePath = this.filePath(record.conversationId, record.processedAt);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  }

  async get(conversationId: string, processedAt: string): Promise<FeedbackRecord | null> {
    const filePath = this.filePath(conversationId, processedAt);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      logger.warn(`FileFeedbackStore: JSON inválido em ${filePath} — ignorado.`);
      return null;
    }
    const parsed = feedbackRecordSchema.safeParse(value);
    if (!parsed.success) {
      logger.warn(`FileFeedbackStore: feedback fora do contrato em ${filePath} — ignorado.`);
      return null;
    }
    return parsed.data;
  }
}

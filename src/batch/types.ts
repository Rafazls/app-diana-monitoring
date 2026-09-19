import type { ConversationMessage } from "../contracts/index.js";

export interface Batch {
  batchId: string;
  conversationId: string;
  childName: string;
  contactName: string;
  /** ISO 8601 — quando o batch foi fechado. */
  createdAt: string;
  messages: ConversationMessage[];
}

export interface BatchStore {
  readonly name: string;
  init(): Promise<void>;
  save(batch: Batch): Promise<void>;
  recent(conversationId: string, limit: number): Promise<Batch[]>;
  close(): Promise<void>;
}

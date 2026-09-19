import type { Batch, BatchStore } from "./types.js";

export class MemoryBatchStore implements BatchStore {
  readonly name = "memory";
  private readonly byConversation = new Map<string, Batch[]>();

  async init(): Promise<void> {}

  async save(batch: Batch): Promise<void> {
    const lista = this.byConversation.get(batch.conversationId) ?? [];
    lista.push({ ...batch, messages: [...batch.messages] });
    this.byConversation.set(batch.conversationId, lista);
  }

  async recent(conversationId: string, limit: number): Promise<Batch[]> {
    const lista = this.byConversation.get(conversationId) ?? [];
    return lista.slice(-limit).map((b) => ({ ...b, messages: [...b.messages] }));
  }

  async close(): Promise<void> {
    this.byConversation.clear();
  }
}

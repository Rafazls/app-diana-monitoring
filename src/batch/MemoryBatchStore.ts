/**
 * Batches em memória — padrão para desenvolvimento e demonstração.
 *
 * Some no reinício, o que é aceitável para testar; não é aceitável em produção,
 * onde o histórico é justamente o que dá contexto à análise.
 */
import type { Batch, BatchStore } from "./types.js";

export class MemoryBatchStore implements BatchStore {
  readonly name = "memory";
  private readonly byConversation = new Map<string, Batch[]>();

  async init(): Promise<void> {
    // Nada a preparar.
  }

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

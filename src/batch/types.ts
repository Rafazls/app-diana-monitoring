/**
 * Batches: a unidade de trabalho do monitoramento.
 *
 * Mensagens não são analisadas uma a uma. A cada intervalo, o que chegou vira
 * um BATCH, que é persistido. A análise então junta os ÚLTIMOS N batches para
 * enxergar a conversa com contexto — aproximação abusiva é gradual, e uma
 * mensagem isolada quase nunca denuncia o padrão.
 *
 * Persistir antes de analisar também significa que uma falha na análise não
 * perde a mensagem: o batch continua lá para a próxima janela.
 */
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
  /** Prepara o destino (cria tabelas, abre pool). Idempotente. */
  init(): Promise<void>;
  save(batch: Batch): Promise<void>;
  /** Os `limit` batches mais recentes da conversa, do mais antigo ao mais novo. */
  recent(conversationId: string, limit: number): Promise<Batch[]>;
  close(): Promise<void>;
}

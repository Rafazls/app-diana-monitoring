/**
 * Fronteira de ingestão: de onde vêm as mensagens.
 *
 * A fonte apenas ENTREGA mensagens, uma a uma, assim que chegam. Quem decide
 * como agrupá-las em batches e quando analisar é o scheduler — assim a regra
 * de janela vale igual para o Telegram e para as fixtures, e mudar a cadência
 * não exige tocar em nenhuma fonte.
 */
import type { IncomingMessage } from "../batch/scheduler.js";

export type { IncomingMessage };

export interface ConversationSource {
  readonly name: string;
  /** Começa a produzir. Cada mensagem nova vai para `onMessage`. */
  start(onMessage: (message: IncomingMessage) => void): Promise<void>;
  stop(): Promise<void>;
}

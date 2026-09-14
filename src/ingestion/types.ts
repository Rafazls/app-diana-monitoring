/**
 * Fronteira de ingestão: de onde vêm as conversas a analisar.
 *
 * O pipeline não sabe se a mensagem veio do Telegram ou de um arquivo de
 * exemplo — ele só recebe `Conversation`. É o que permite desenvolver e
 * demonstrar sem bot, e ligar o bot depois sem tocar na análise.
 */
import type { Conversation } from "../contracts/index.js";

export interface ConversationSource {
  /** Nome legível da fonte (aparece no /health). */
  readonly name: string;

  /**
   * Começa a produzir conversas. Cada vez que uma conversa tem novidade
   * suficiente para valer uma análise, `onConversation` é chamado com ela.
   */
  start(onConversation: (conversation: Conversation) => Promise<void>): Promise<void>;

  /** Encerra a fonte (parar o polling, fechar conexões). */
  stop(): Promise<void>;
}

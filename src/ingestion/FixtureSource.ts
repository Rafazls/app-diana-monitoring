/**
 * Ingestão de demonstração: reproduz as conversas de exemplo.
 *
 * É o que faz o backend subir útil em qualquer máquina, sem bot e sem token —
 * e o que garante que a tela do responsável tenha o que mostrar numa
 * apresentação.
 */
import type { Conversation } from "../contracts/index.js";
import { logger } from "../logger.js";
import { demoConversations } from "./fixtures.js";
import type { ConversationSource } from "./types.js";

export class FixtureSource implements ConversationSource {
  readonly name = "fixtures";
  private stopped = false;

  async start(onConversation: (conversation: Conversation) => Promise<void>): Promise<void> {
    logger.info(`Ingestão por fixtures: ${demoConversations.length} conversas de exemplo.`);
    for (const conversation of demoConversations) {
      if (this.stopped) return;
      await onConversation(conversation);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

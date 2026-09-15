/**
 * Ingestão de demonstração: reproduz as conversas de exemplo.
 *
 * Faz o backend subir útil em qualquer máquina, sem bot e sem token — e garante
 * que a tela do responsável tenha o que mostrar numa apresentação.
 */
import { logger } from "../logger.js";
import { demoConversations } from "./fixtures.js";
import type { ConversationSource, IncomingMessage } from "./types.js";

export class FixtureSource implements ConversationSource {
  readonly name = "fixtures";
  private stopped = false;

  async start(onMessage: (message: IncomingMessage) => void): Promise<void> {
    logger.info(`Ingestão por fixtures: ${demoConversations.length} conversas de exemplo.`);
    for (const conversation of demoConversations) {
      if (this.stopped) return;
      for (const message of conversation.messages) {
        onMessage({
          conversationId: conversation.id,
          childName: conversation.childName,
          contactName: conversation.contactName,
          message,
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

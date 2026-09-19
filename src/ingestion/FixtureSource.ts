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

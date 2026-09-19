import type { IncomingMessage } from "../batch/scheduler.js";

export type { IncomingMessage };

export interface ConversationSource {
  readonly name: string;
  start(onMessage: (message: IncomingMessage) => void): Promise<void>;
  stop(): Promise<void>;
}

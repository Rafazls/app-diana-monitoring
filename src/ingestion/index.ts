import { FixtureSource } from "./FixtureSource.js";
import { TelegramSource } from "./TelegramSource.js";
import type { ConversationSource } from "./types.js";

export * from "./types.js";
export { FixtureSource } from "./FixtureSource.js";
export { TelegramSource } from "./TelegramSource.js";
export { demoConversations } from "./fixtures.js";

export type IngestionKind = "fixtures" | "telegram";

export function createSource(env: NodeJS.ProcessEnv = process.env): ConversationSource {
  const kind = (env.INGESTION ?? "fixtures").toLowerCase() as IngestionKind;

  switch (kind) {
    case "fixtures":
      return new FixtureSource();
    case "telegram":
      return new TelegramSource({
        token: env.TELEGRAM_BOT_TOKEN ?? "",
        ...(env.TELEGRAM_CHILD_ID ? { childTelegramId: env.TELEGRAM_CHILD_ID } : {}),
        childName: env.CHILD_NAME ?? "Criança",
        ...(env.TELEGRAM_API_BASE ? { apiBase: env.TELEGRAM_API_BASE } : {}),
      });
    default:
      throw new Error(`INGESTION inválido: "${String(kind)}". Use "fixtures" ou "telegram".`);
  }
}

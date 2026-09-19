import { logger } from "../logger.js";
import type { ConversationSource, IncomingMessage } from "./types.js";

const DEFAULT_API = "https://api.telegram.org";

interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  from?: TelegramUser;
  chat: { id: number; title?: string; first_name?: string; type: string };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export interface TelegramSourceConfig {
  token: string;
  childTelegramId?: string;
  childName: string;
  apiBase?: string;
}

export class TelegramSource implements ConversationSource {
  readonly name = "telegram";

  private readonly apiBase: string;
  /** Nome do contato por chat, descoberto no primeiro remetente que não é a criança. */
  private readonly contactNames = new Map<number, string>();
  private offset = 0;
  private running = false;
  private onMessage: ((message: IncomingMessage) => void) | null = null;

  constructor(private readonly config: TelegramSourceConfig) {
    if (!config.token) {
      throw new Error(
        "INGESTION=telegram exige TELEGRAM_BOT_TOKEN. " +
          "Use INGESTION=fixtures (padrão) para rodar sem bot.",
      );
    }
    this.apiBase = config.apiBase ?? DEFAULT_API;
  }

  async start(onMessage: (message: IncomingMessage) => void): Promise<void> {
    this.onMessage = onMessage;
    this.running = true;

    const me = await this.call<{ username?: string }>("getMe").catch(() => null);
    logger.info(
      me?.username
        ? `Telegram conectado como @${me.username}. Aguardando mensagens…`
        : "Telegram conectado. Aguardando mensagens…",
    );

    void this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.contactNames.clear();
  }

  /** Laço de long polling. Erro de rede não derruba o backend: espera e insiste. */
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.call<TelegramUpdate[]>("getUpdates", {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ["message", "edited_message"],
        });

        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const message = update.message ?? update.edited_message;
          if (message?.text) this.emit(message);
        }
      } catch (err) {
        if (!this.running) return;
        logger.warn(`Falha no polling do Telegram (tentando de novo em 5s): ${String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  /** Converte o update do Telegram para o formato do domínio e entrega. */
  private emit(message: TelegramMessage): void {
    if (!this.onMessage) return;

    const chatId = message.chat.id;
    const authorId = String(message.from?.id ?? "");
    const isChild =
      this.config.childTelegramId !== undefined && authorId === this.config.childTelegramId;

    if (!isChild && !this.contactNames.has(chatId)) {
      this.contactNames.set(
        chatId,
        message.from?.first_name ?? message.from?.username ?? `Contato ${authorId || "?"}`,
      );
    }

    this.onMessage({
      conversationId: `tg-${chatId}`,
      childName: this.config.childName,
      contactName: this.contactNames.get(chatId) ?? "Contato",
      message: {
        id: `TG-${chatId}-${message.message_id}`,
        author: isChild ? "child" : "other",
        text: message.text ?? "",
        timestamp: new Date(message.date * 1000).toISOString(),
      },
    });
  }

  private async call<T>(method: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.apiBase}/bot${this.config.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });

    const payload = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!payload.ok) throw new Error(payload.description ?? `Telegram respondeu ${response.status}`);
    return payload.result as T;
  }
}

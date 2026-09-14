/**
 * Ingestão real via Telegram Bot API (long polling em `getUpdates`).
 *
 * Long polling em vez de webhook porque a demo precisa rodar em qualquer
 * máquina, sem domínio público nem HTTPS. Trocar por webhook depois é
 * localizado: só esta classe muda.
 *
 * ⚠️ Escopo do que o bot vê: a Bot API do Telegram só entrega ao bot as
 * mensagens de chats em que ele foi adicionado (e, em grupos, apenas as
 * dirigidas a ele, salvo se o modo privacidade for desligado pelo dono do bot).
 * Não existe — e este código não tenta — leitura de conversas alheias.
 *
 * Janela de análise: mensagens são acumuladas por chat e analisadas quando a
 * conversa fica "madura" (silêncio de `IDLE_MS` ou `MAX_BUFFER` mensagens),
 * para não chamar o analisador a cada tecla digitada.
 */
import type { Conversation, ConversationMessage } from "../contracts/index.js";
import { logger } from "../logger.js";
import type { ConversationSource } from "./types.js";

const DEFAULT_API = "https://api.telegram.org";

/** Silêncio que fecha a janela de análise de um chat. */
const DEFAULT_IDLE_MS = 20_000;
/** Teto de mensagens acumuladas antes de analisar de qualquer forma. */
const MAX_BUFFER = 40;
/** Janela de contexto: mensagens mais antigas que isso saem do buffer. */
const CONTEXT_MS = 6 * 60 * 60 * 1000;

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

interface Buffered {
  messages: ConversationMessage[];
  chatTitle: string;
  childName: string;
  contactName: string;
  timer: NodeJS.Timeout | null;
}

export interface TelegramSourceConfig {
  token: string;
  /**
   * Id numérico do Telegram correspondente à CRIANÇA monitorada. Mensagens
   * deste id são marcadas como `child`; todas as outras, como `other`. Sem ele
   * não há como distinguir quem fala o quê, e a análise perde sentido (vários
   * padrões só contam vindos do interlocutor).
   */
  childTelegramId?: string;
  childName: string;
  /**
   * Base da Bot API. Trocável para apontar a um simulador local e exercitar
   * este código inteiro — polling, janela, mapeamento de autor — sem depender
   * do Telegram real (ver `tools/telegram-sim.mjs`).
   */
  apiBase?: string;
  /** Silêncio que fecha a janela. Reduza para testar sem esperar 20s. */
  idleMs?: number;
}

export class TelegramSource implements ConversationSource {
  readonly name = "telegram";

  private readonly buffers = new Map<number, Buffered>();
  private readonly apiBase: string;
  private readonly idleMs: number;
  private offset = 0;
  private running = false;
  private onConversation: ((conversation: Conversation) => Promise<void>) | null = null;

  constructor(private readonly config: TelegramSourceConfig) {
    this.apiBase = config.apiBase ?? DEFAULT_API;
    this.idleMs = config.idleMs ?? DEFAULT_IDLE_MS;

    if (!config.token) {
      throw new Error(
        "INGESTION=telegram exige TELEGRAM_BOT_TOKEN. " +
          "Use INGESTION=fixtures (padrão) para rodar sem bot.",
      );
    }
  }

  async start(onConversation: (conversation: Conversation) => Promise<void>): Promise<void> {
    this.onConversation = onConversation;
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
    for (const buffer of this.buffers.values()) {
      if (buffer.timer) clearTimeout(buffer.timer);
    }
    this.buffers.clear();
  }

  /** Laço de long polling. Erro de rede não derruba o backend: espera e tenta de novo. */
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
          if (message?.text) this.ingest(message);
        }
      } catch (err) {
        if (!this.running) return;
        logger.warn(`Falha no polling do Telegram (tentando de novo em 5s): ${String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  /** Acumula a mensagem no buffer do chat e reagenda o fechamento da janela. */
  private ingest(message: TelegramMessage): void {
    const chatId = message.chat.id;
    const authorId = String(message.from?.id ?? "");
    const isChild =
      this.config.childTelegramId !== undefined && authorId === this.config.childTelegramId;

    const existing = this.buffers.get(chatId);
    const contactName =
      message.from?.first_name ?? message.from?.username ?? `Contato ${authorId || "?"}`;

    const buffer: Buffered = existing ?? {
      messages: [],
      chatTitle: message.chat.title ?? message.chat.first_name ?? `Chat ${chatId}`,
      childName: this.config.childName,
      // O nome do contato é o do primeiro remetente que não é a criança.
      contactName: isChild ? "Contato" : contactName,
      timer: null,
    };

    if (!isChild && buffer.contactName === "Contato") buffer.contactName = contactName;

    buffer.messages.push({
      id: `TG-${chatId}-${message.message_id}`,
      author: isChild ? "child" : "other",
      text: message.text ?? "",
      timestamp: new Date(message.date * 1000).toISOString(),
    });

    // Mantém só a janela de contexto recente.
    const cutoff = Date.now() - CONTEXT_MS;
    buffer.messages = buffer.messages.filter((m) => Date.parse(m.timestamp) >= cutoff);

    if (buffer.timer) clearTimeout(buffer.timer);
    buffer.timer = setTimeout(() => void this.flush(chatId), this.idleMs);
    this.buffers.set(chatId, buffer);

    if (buffer.messages.length >= MAX_BUFFER) void this.flush(chatId);
  }

  /** Fecha a janela do chat e manda a conversa para análise. */
  private async flush(chatId: number): Promise<void> {
    const buffer = this.buffers.get(chatId);
    if (!buffer || buffer.messages.length === 0 || !this.onConversation) return;

    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    const conversation: Conversation = {
      id: `tg-${chatId}`,
      childId: this.config.childTelegramId ?? "child",
      childName: buffer.childName,
      contactId: String(chatId),
      contactName: buffer.contactName,
      startedAt: buffer.messages[0]?.timestamp ?? new Date().toISOString(),
      messages: [...buffer.messages],
    };

    try {
      await this.onConversation(conversation);
    } catch (err) {
      logger.error(`Falha ao analisar a conversa do chat ${chatId}`, err);
    }
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

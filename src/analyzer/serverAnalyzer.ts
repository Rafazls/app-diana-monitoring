/**
 * Motor de análise por servidor de modelo próprio.
 *
 * Fala o dialeto da API da OpenAI (`/v1/chat/completions`), que virou o padrão
 * de fato: llama.cpp server, Ollama, vLLM, LM Studio e TGI aceitam todos esse
 * mesmo formato. A consequência prática é que o projeto não fica preso a
 * fornecedor nenhum — trocar o modelo, ou a máquina onde ele roda, é mudar uma
 * URL.
 *
 * O modelo pode estar numa VM da Oracle, num servidor da escola ou na máquina
 * ao lado. Em qualquer caso a conversa da criança não passa por terceiro.
 */
import type { AnalysisResult, AuditEntry, Conversation, DetectedSignal } from "../contracts/index.js";
import { logger } from "../logger.js";
import { extractFeatures } from "./features.js";
import { buildUserPrompt, parseLlmResponse, SYSTEM_PROMPT } from "./prompt.js";
import { consolidate, SIGNAL_DESCRIPTIONS, SIGNAL_TITLES } from "./riskEngine.js";
import type { RiskAnalyzer } from "./types.js";

export interface ServerAnalyzerConfig {
  /** Base da API, ex.: http://10.0.0.5:8080/v1 */
  baseUrl: string;
  /** Nome do modelo conforme o servidor o publica. */
  model: string;
  /** Opcional — muitos servidores locais não exigem. */
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Pede saída JSON ao servidor, quando ele suporta. */
  jsonMode?: boolean;
  fallback?: RiskAnalyzer;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Erros que vale repetir: fila cheia, serviço subindo, instabilidade de rede. */
function vaiPassar(status: number | null, err: unknown): boolean {
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  const msg = String((err as Error)?.message ?? "").toLowerCase();
  return msg.includes("econnrefused") || msg.includes("timeout") || msg.includes("socket");
}

export class ServerRiskAnalyzer implements RiskAnalyzer {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: ServerAnalyzerConfig) {
    if (!config.baseUrl) {
      throw new Error("ANALYZER=server exige MODEL_SERVER_URL (ex.: http://IP:8080/v1).");
    }
    if (!config.model) {
      throw new Error("ANALYZER=server exige MODEL_SERVER_MODEL (nome do modelo no servidor).");
    }
    // Aceita a URL com ou sem a barra final, para não punir erro de digitação.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? 120_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.name = `server:${config.model}`;
  }

  private async chamar(conversation: Conversation): Promise<string> {
    const corpo: Record<string, unknown> = {
      model: this.config.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(conversation) },
      ],
      // Determinismo: a mesma conversa deve produzir o mesmo veredito.
      temperature: 0,
      max_tokens: 800,
      stream: false,
    };
    if (this.config.jsonMode !== false) corpo.response_format = { type: "json_object" };

    const controller = new AbortController();
    const relogio = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resposta = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(corpo),
        signal: controller.signal,
      });

      if (!resposta.ok) {
        const detalhe = await resposta.text().catch(() => "");
        const erro = new Error(`servidor respondeu ${resposta.status}: ${detalhe.slice(0, 200)}`);
        (erro as Error & { status: number }).status = resposta.status;
        throw erro;
      }

      const payload = (await resposta.json()) as ChatCompletion;
      if (payload.error?.message) throw new Error(payload.error.message);

      const texto = payload.choices?.[0]?.message?.content;
      if (typeof texto !== "string" || texto.length === 0) {
        throw new Error("resposta sem conteúdo");
      }
      return texto;
    } finally {
      clearTimeout(relogio);
    }
  }

  async analyze(conversation: Conversation): Promise<AnalysisResult> {
    const processedAt = new Date().toISOString();
    const { features } = extractFeatures(conversation);
    const audit: AuditEntry[] = [];

    try {
      const inicio = Date.now();
      let texto = "";
      let tentativa = 0;

      for (;;) {
        try {
          texto = await this.chamar(conversation);
          break;
        } catch (err) {
          const status = (err as { status?: number }).status ?? null;
          if (!vaiPassar(status, err) || tentativa >= this.maxRetries) throw err;
          // Espaçamento crescente com jitter, para não repetir em bloco.
          const espera = Math.round(2 ** tentativa * 1000 * (1 + Math.random() * 0.3));
          tentativa += 1;
          logger.warn(
            `Servidor de modelo indisponível. Tentativa ${tentativa}/${this.maxRetries} em ${espera}ms.`,
          );
          await sleep(espera);
        }
      }

      audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description:
          `Modelo ${this.config.model} respondeu em ${Date.now() - inicio}ms` +
          (tentativa > 0 ? ` após ${tentativa} repetição(ões).` : "."),
      });

      const parsed = parseLlmResponse(texto);
      if (!parsed.ok || !parsed.response) {
        throw new Error(`resposta fora do contrato (${parsed.error})`);
      }

      // Só aceita sinais ancorados em mensagens que existem de verdade.
      const idsValidos = new Set(conversation.messages.map((m) => m.id));
      const signals: DetectedSignal[] = parsed.response.signals
        .map((s, i) => {
          const ids = s.messageIds.filter((id) => idsValidos.has(id));
          if (ids.length === 0) return null;
          return {
            id: `SIG-${String(i + 1).padStart(3, "0")}`,
            type: s.type,
            confidence: Number(Math.min(Math.max(s.confidence, 0), 1).toFixed(2)),
            messageIds: ids,
            title: SIGNAL_TITLES[s.type] ?? s.type,
            description: SIGNAL_DESCRIPTIONS[s.type] ?? "Padrão de risco identificado na conversa.",
            severity: s.severity,
          } satisfies DetectedSignal;
        })
        .filter((s): s is DetectedSignal => s !== null);

      const descartados = parsed.response.signals.length - signals.length;
      if (descartados > 0) {
        logger.warn(`Servidor: ${descartados} sinal(is) descartado(s) por citar mensagem inexistente.`);
      }

      return consolidate({
        conversationId: conversation.id,
        signals,
        features,
        modelName: this.name,
        modelVersion: "self-hosted",
        environment: "production",
        processedAt,
        extraAudit: audit,
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      logger.error(`Servidor de modelo falhou (${motivo}).`);

      if (!this.config.fallback) throw err;

      logger.warn("Analisando com a heurística local para não perder a conversa.");
      const resultado = await this.config.fallback.analyze(conversation);
      resultado.audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description: `Servidor de modelo indisponível (${motivo}); análise feita pela heurística.`,
      });
      return resultado;
    }
  }
}

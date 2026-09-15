/**
 * Motor de análise local (edge AI) — o modelo roda na própria máquina.
 *
 * Para este produto, edge não é só uma alternativa à nuvem: é a opção mais
 * coerente com a premissa. A conversa de uma criança nunca sai do equipamento
 * — não há requisição para terceiro, não há trecho trafegando, não há custo por
 * token e não há dependência de rede para proteger alguém.
 *
 * Duas escolhas que sustentam a confiabilidade:
 *
 * 1. GRAMÁTICA POR SCHEMA. O llama.cpp restringe a geração ao formato esperado,
 *    então o modelo é incapaz de devolver JSON inválido. O caminho da nuvem
 *    precisa torcer para o modelo obedecer à instrução; aqui isso é garantido
 *    pelo decodificador.
 *
 * 2. FILA DE UMA POSIÇÃO. Um contexto do llama.cpp não é reentrante. Como o
 *    scheduler pode fechar batches de várias conversas no mesmo tique, as
 *    análises são serializadas — sem isso, duas conversas simultâneas
 *    corromperiam o estado do contexto.
 */
import path from "node:path";
import type { AnalysisResult, AuditEntry, Conversation, DetectedSignal } from "../contracts/index.js";
import { logger } from "../logger.js";
import { extractFeatures } from "./features.js";
import { buildUserPrompt, SIGNAL_TYPES, parseLlmResponse, SYSTEM_PROMPT } from "./prompt.js";
import { consolidate, SIGNAL_DESCRIPTIONS, SIGNAL_TITLES } from "./riskEngine.js";
import type { RiskAnalyzer } from "./types.js";

export interface EdgeAnalyzerConfig {
  /** Caminho do .gguf, ou um URI aceito pelo resolvedor (hf:...). */
  modelPath: string;
  /** Pasta onde modelos baixados ficam em cache. */
  modelsDir?: string;
  /** Tamanho da janela de contexto do modelo. */
  contextSize?: number;
  /** Teto de tokens da resposta — a saída aqui é curta por natureza. */
  maxTokens?: number;
  /** Camadas na GPU. 0 força CPU; undefined deixa a biblioteca decidir. */
  gpuLayers?: number;
  /** Motor de reserva se o modelo não carregar. */
  fallback?: RiskAnalyzer;
}

/** O formato exato que o modelo é obrigado a produzir. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { enum: SIGNAL_TYPES },
          messageIds: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
          severity: { enum: ["low", "medium", "high"] },
        },
        required: ["type", "messageIds", "confidence", "severity"],
      },
    },
  },
  required: ["signals"],
} as const;

export class EdgeRiskAnalyzer implements RiskAnalyzer {
  readonly name: string;

  private loading: Promise<void> | null = null;
  private llamaModel: unknown = null;
  private context: unknown = null;
  private grammar: unknown = null;
  /** Serializa as análises: o contexto do llama.cpp não é reentrante. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: EdgeAnalyzerConfig) {
    if (!config.modelPath) {
      throw new Error("ANALYZER=edge exige EDGE_MODEL_PATH (caminho do .gguf ou URI hf:).");
    }
    this.name = `edge:${path.basename(config.modelPath).replace(/\.gguf$/i, "")}`;
  }

  /** Carrega o modelo uma única vez. O boot não espera por isso. */
  private async ensureLoaded(): Promise<void> {
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const { getLlama, resolveModelFile, LlamaJsonSchemaGrammar } = await import("node-llama-cpp");

      const inicio = Date.now();
      const llama = await getLlama();

      const modelPath = this.config.modelPath.includes("://") ||
        this.config.modelPath.startsWith("hf:")
        ? await resolveModelFile(this.config.modelPath, this.config.modelsDir ?? "./models")
        : this.config.modelPath;

      logger.info(`Edge AI: carregando ${path.basename(modelPath)}…`);

      const model = await llama.loadModel({
        modelPath,
        ...(this.config.gpuLayers !== undefined ? { gpuLayers: this.config.gpuLayers } : {}),
      });

      const context = await model.createContext({
        contextSize: this.config.contextSize ?? 4096,
      });

      this.llamaModel = model;
      this.context = context;
      this.grammar = new LlamaJsonSchemaGrammar(llama, RESPONSE_SCHEMA as never);

      logger.info(
        `Edge AI: pronto em ${((Date.now() - inicio) / 1000).toFixed(1)}s ` +
          `(backend ${llama.gpu || "cpu"}, saída garantida por gramática).`,
      );
    })();

    return this.loading;
  }

  /** Enfileira o trabalho para que só uma inferência aconteça por vez. */
  private serializar<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.fila.then(tarefa, tarefa);
    // A fila segue viva mesmo se uma análise falhar.
    this.fila = resultado.catch(() => undefined);
    return resultado;
  }

  async analyze(conversation: Conversation): Promise<AnalysisResult> {
    const processedAt = new Date().toISOString();
    const { features } = extractFeatures(conversation);
    const audit: AuditEntry[] = [];

    try {
      await this.ensureLoaded();

      const texto = await this.serializar(async () => {
        const { LlamaChatSession } = await import("node-llama-cpp");
        const ctx = this.context as { getSequence(): { dispose(): void } };

        /**
         * A sequência vem de um pool finito do contexto e PRECISA ser
         * devolvida. Sem o `finally`, a segunda análise morre com "No
         * sequences left" — e o serviço fica vivo, analisando só a primeira
         * conversa da sua vida.
         */
        const sequence = ctx.getSequence();
        try {
          // Sessão nova a cada análise: uma conversa não influencia a outra.
          const session = new LlamaChatSession({
            contextSequence: sequence as never,
            systemPrompt: SYSTEM_PROMPT,
          });

          const inicio = Date.now();
          const resposta = await session.prompt(buildUserPrompt(conversation), {
            grammar: this.grammar as never,
            maxTokens: this.config.maxTokens ?? 800,
            // Determinismo importa: a mesma conversa deve dar o mesmo veredito.
            temperature: 0,
          });
          audit.push({
            timestamp: processedAt,
            stage: "ml_analysis",
            description: `Modelo local respondeu em ${Date.now() - inicio}ms.`,
          });

          session.dispose();
          return resposta;
        } finally {
          sequence.dispose();
        }
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
        logger.warn(`Edge AI: ${descartados} sinal(is) descartado(s) por citar mensagem inexistente.`);
      }

      return consolidate({
        conversationId: conversation.id,
        signals,
        features,
        modelName: this.name,
        modelVersion: "local",
        environment: "production",
        processedAt,
        extraAudit: audit,
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      logger.error(`Edge AI falhou (${motivo}).`);

      if (!this.config.fallback) throw err;

      logger.warn("Analisando com a heurística local para não perder a conversa.");
      const resultado = await this.config.fallback.analyze(conversation);
      resultado.audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description: `Modelo local indisponível (${motivo}); análise feita pela heurística.`,
      });
      return resultado;
    }
  }

  /** Libera o modelo da memória. */
  async dispose(): Promise<void> {
    const ctx = this.context as { dispose?(): Promise<void> } | null;
    const model = this.llamaModel as { dispose?(): Promise<void> } | null;
    await ctx?.dispose?.();
    await model?.dispose?.();
    this.context = null;
    this.llamaModel = null;
    this.loading = null;
  }
}

import * as genai from "oci-generativeaiinference";
import * as common from "oci-common";
import type { AnalysisResult, AuditEntry, Conversation, DetectedSignal } from "../contracts/index.js";
import { extractFeatures } from "./features.js";
import { logger } from "../logger.js";
import { buildUserPrompt, parseLlmResponse, SYSTEM_PROMPT } from "./prompt.js";
import { consolidate, SIGNAL_DESCRIPTIONS, SIGNAL_TITLES } from "./riskEngine.js";
import type { RiskAnalyzer } from "./types.js";

export type ModelFamily = "cohere" | "generic";

export interface OciAnalyzerConfig {
  compartmentId: string;
  modelId: string;
  region: string;
  family: ModelFamily;
  tenancyId?: string;
  userId?: string;
  fingerprint?: string;
  privateKey?: string;
  passphrase?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fallback?: RiskAnalyzer;
}

/** Monta o provedor de autenticação conforme o que foi configurado. */
function buildAuthProvider(
  config: OciAnalyzerConfig,
): common.AuthenticationDetailsProvider | Promise<common.AuthenticationDetailsProvider> {
  const temChaves = Boolean(config.tenancyId && config.userId && config.fingerprint && config.privateKey);

  if (temChaves) {
    logger.info("OCI: autenticando com chaves de API do ambiente.");
    return new common.SimpleAuthenticationDetailsProvider(
      config.tenancyId!,
      config.userId!,
      config.fingerprint!,
      config.privateKey!,
      config.passphrase ?? null,
      common.Region.fromRegionId(config.region),
    );
  }

  // Sem chaves: é o caminho de produção em Container Instance.
  logger.info("OCI: sem chaves no ambiente, tentando instance principal.");
  return new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
}

function isThrottled(err: unknown): boolean {
  const e = err as { statusCode?: number; status?: number; message?: string };
  if (e?.statusCode === 429 || e?.status === 429) return true;
  const msg = String(e?.message ?? err ?? "").toLowerCase();
  return msg.includes("429") || msg.includes("throttl") || msg.includes("too many requests");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OciRiskAnalyzer implements RiskAnalyzer {
  readonly name: string;
  private client: genai.GenerativeAiInferenceClient | null = null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(private readonly config: OciAnalyzerConfig) {
    const faltando = (["compartmentId", "modelId", "region"] as const).filter((k) => !config[k]);
    if (faltando.length > 0) {
      throw new Error(
        `ANALYZER=oci exige: ${faltando
          .map((k) => "OCI_" + k.replace(/([A-Z])/g, "_$1").toUpperCase())
          .join(", ")}. Veja o .env.example.`,
      );
    }
    this.name = `oci:${config.modelId}`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /** Cliente é criado sob demanda: o boot não deve depender da nuvem. */
  private async getClient(): Promise<genai.GenerativeAiInferenceClient> {
    if (this.client) return this.client;

    const provider = await buildAuthProvider(this.config);
    const client = new genai.GenerativeAiInferenceClient({ authenticationDetailsProvider: provider });
    client.regionId = this.config.region;
    this.client = client;
    return client;
  }

  /** Monta o corpo da requisição conforme a família do modelo. */
  private buildChatRequest(conversation: Conversation): Record<string, unknown> {
    const userPrompt = buildUserPrompt(conversation);

    if (this.config.family === "cohere") {
      return {
        compartmentId: this.config.compartmentId,
        servingMode: {
          servingType: "ON_DEMAND",
          modelId: this.config.modelId,
        },
        chatRequest: {
          apiFormat: "COHERE",
          preambleOverride: SYSTEM_PROMPT,
          message: userPrompt,
          maxTokens: 2000,
          // Temperatura baixa: queremos consistência, não criatividade.
          temperature: 0.1,
          isStream: false,
        },
      };
    }

    return {
      compartmentId: this.config.compartmentId,
      servingMode: {
        servingType: "ON_DEMAND",
        modelId: this.config.modelId,
      },
      chatRequest: {
        apiFormat: "GENERIC",
        messages: [
          { role: "SYSTEM", content: [{ type: "TEXT", text: SYSTEM_PROMPT }] },
          { role: "USER", content: [{ type: "TEXT", text: userPrompt }] },
        ],
        maxTokens: 2000,
        temperature: 0.1,
        isStream: false,
      },
    };
  }

  /** Extrai o texto da resposta, que muda de forma entre as famílias. */
  private extractText(response: unknown): string {
    const r = response as Record<string, any>;
    const chat = r?.chatResult?.chatResponse ?? r?.chatResponse ?? r;

    // Cohere devolve `text`; genérico devolve choices[].message.content[].text
    if (typeof chat?.text === "string") return chat.text;

    const conteudo = chat?.choices?.[0]?.message?.content;
    if (Array.isArray(conteudo)) {
      return conteudo.map((c: { text?: string }) => c?.text ?? "").join("");
    }
    if (typeof conteudo === "string") return conteudo;

    throw new Error("formato de resposta não reconhecido");
  }

  async analyze(conversation: Conversation): Promise<AnalysisResult> {
    const processedAt = new Date().toISOString();
    const { features } = extractFeatures(conversation);
    const audit: AuditEntry[] = [];

    try {
      const client = await this.getClient();
      const request = this.buildChatRequest(conversation);

      audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description: `Enviado ao modelo ${this.config.modelId} (${conversation.messages.length} mensagens).`,
      });

      const inicio = Date.now();
      let resposta: unknown;
      let tentativa = 0;
      for (;;) {
        try {
          resposta = await Promise.race([
            client.chat({ chatDetails: request as never }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`timeout de ${this.timeoutMs}ms`)), this.timeoutMs),
            ),
          ]);
          break;
        } catch (err) {
          if (!isThrottled(err) || tentativa >= this.maxRetries) throw err;
          const espera = Math.round(2 ** tentativa * 1000 * (1 + Math.random() * 0.3));
          tentativa += 1;
          logger.warn(
            `OCI respondeu 429 (limite da tenancy). Tentativa ${tentativa}/${this.maxRetries} em ${espera}ms.`,
          );
          await sleep(espera);
        }
      }

      const duracao = Date.now() - inicio;
      if (tentativa > 0) {
        audit.push({
          timestamp: processedAt,
          stage: "ml_analysis",
          description: `Requisição repetida ${tentativa}x por limite de taxa da tenancy.`,
        });
      }

      const texto = this.extractText(resposta);
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
            confidence: Number(s.confidence.toFixed(2)),
            messageIds: ids,
            title: SIGNAL_TITLES[s.type] ?? s.type,
            description: SIGNAL_DESCRIPTIONS[s.type] ?? "Padrão de risco identificado na conversa.",
            severity: s.severity,
          } satisfies DetectedSignal;
        })
        .filter((s): s is DetectedSignal => s !== null);

      const descartados = parsed.response.signals.length - signals.length;
      if (descartados > 0) {
        logger.warn(`OCI: ${descartados} sinal(is) descartado(s) por citar mensagem inexistente.`);
      }

      audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description: `Modelo respondeu em ${duracao}ms com ${signals.length} sinal(is).`,
      });

      return consolidate({
        conversationId: conversation.id,
        signals,
        features,
        modelName: this.name,
        modelVersion: "1",
        environment: "production",
        processedAt,
        extraAudit: audit,
      });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      if (isThrottled(err)) {
        logger.error(
          "OCI Generative AI segue limitando a taxa após as tentativas. " +
            "Se isso persistir, o limite da tenancy precisa ser aumentado " +
            "(veja docs/provisionamento-oci.md).",
        );
      } else {
        logger.error(`OCI Generative AI falhou (${motivo}).`);
      }

      if (!this.config.fallback) throw err;

      logger.warn("Analisando com a heurística local para não perder a conversa.");
      const resultado = await this.config.fallback.analyze(conversation);
      resultado.audit.push({
        timestamp: processedAt,
        stage: "ml_analysis",
        description: `Modelo na nuvem indisponível (${motivo}); análise feita pela heurística local.`,
      });
      return resultado;
    }
  }
}

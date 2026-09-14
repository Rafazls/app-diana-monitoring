/**
 * Configuração do backend, validada por zod.
 *
 * Todo default roda a demo SEM credencial nenhuma: fixtures + análise mock +
 * memória. Ligar Telegram ou OCI é mudar variável, nunca código.
 */
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGINS: z.string().default("*"),

  INGESTION: z.enum(["fixtures", "telegram"]).default("fixtures"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHILD_ID: z.string().default(""),
  CHILD_NAME: z.string().default("Criança"),
  /** Base da Bot API — aponte para o simulador local para testar sem Telegram. */
  TELEGRAM_API_BASE: z.string().default(""),
  /** Silêncio (ms) que fecha a janela de análise. Baixe para testar rápido. */
  TELEGRAM_IDLE_MS: z.coerce.number().int().min(500).default(20_000),

  ANALYZER: z.enum(["mock", "oci"]).default("mock"),
  OCI_COMPARTMENT_ID: z.string().default(""),
  OCI_MODEL_ID: z.string().default(""),
  OCI_REGION: z.string().default(""),

  STORE: z.enum(["memory", "file"]).default("memory"),
  STATE_DIR: z.string().min(1).default("./.state"),

  /** Vazio = API aberta (só demo). Definido = exige header `x-api-key`. */
  GUARDIAN_API_KEY: z.string().default(""),
});

export interface AppConfig {
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
  corsOrigins: string[];
  ingestion: "fixtures" | "telegram";
  analyzer: "mock" | "oci";
  store: "memory" | "file";
  childName: string;
  apiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  const data = parsed.data;

  // Falhar no boot é melhor do que subir um bot que nunca recebe nada.
  if (data.INGESTION === "telegram" && !data.TELEGRAM_BOT_TOKEN) {
    throw new Error("INGESTION=telegram exige TELEGRAM_BOT_TOKEN.");
  }

  return {
    port: data.PORT,
    host: data.HOST,
    logLevel: data.LOG_LEVEL,
    corsOrigins: data.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    ingestion: data.INGESTION,
    analyzer: data.ANALYZER,
    store: data.STORE,
    childName: data.CHILD_NAME,
    apiKey: data.GUARDIAN_API_KEY,
  };
}

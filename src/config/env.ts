/**
 * Configuração do backend, validada por zod.
 *
 * Todo default roda sem credencial nenhuma: fixtures + heurística local +
 * memória. Ligar Telegram, OCI ou Oracle é mudar variável, nunca código.
 *
 * A validação falha no BOOT quando falta algo essencial. Subir um serviço que
 * conecta mas nunca analisa é a pior forma de errar aqui: parece que funciona.
 */
import { z } from "zod";

const schema = z.object({
  // --- servidor ---
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGINS: z.string().default("*"),
  GUARDIAN_API_KEY: z.string().default(""),

  // --- ingestão ---
  INGESTION: z.enum(["fixtures", "telegram"]).default("fixtures"),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHILD_ID: z.string().default(""),
  CHILD_NAME: z.string().default("Criança"),
  TELEGRAM_API_BASE: z.string().default(""),

  // --- batches ---
  /** De quanto em quanto tempo procurar mensagem nova. */
  BATCH_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
  /** Quantos batches formam a janela de contexto da análise. */
  CONTEXT_BATCHES: z.coerce.number().int().min(1).max(20).default(3),

  // --- análise ---
  ANALYZER: z.enum(["mock", "oci"]).default("mock"),
  OCI_COMPARTMENT_ID: z.string().default(""),
  OCI_MODEL_ID: z.string().default(""),
  OCI_REGION: z.string().default(""),
  OCI_MODEL_FAMILY: z.enum(["cohere", "generic"]).default("cohere"),
  OCI_TENANCY_ID: z.string().default(""),
  OCI_USER_ID: z.string().default(""),
  OCI_FINGERPRINT: z.string().default(""),
  OCI_PRIVATE_KEY: z.string().default(""),
  OCI_PASSPHRASE: z.string().default(""),
  OCI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),

  // --- persistência ---
  STORE: z.enum(["memory", "file", "oracle"]).default("memory"),
  STATE_DIR: z.string().min(1).default("./.state"),
  ORACLE_USER: z.string().default(""),
  ORACLE_PASSWORD: z.string().default(""),
  ORACLE_CONNECT_STRING: z.string().default(""),
  ORACLE_WALLET_DIR: z.string().default(""),
  ORACLE_WALLET_PASSWORD: z.string().default(""),
});

export interface AppConfig {
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
  corsOrigins: string[];
  apiKey: string;
  ingestion: "fixtures" | "telegram";
  analyzer: "mock" | "oci";
  store: "memory" | "file" | "oracle";
  childName: string;
  batchIntervalMs: number;
  contextBatches: number;
  oracle: {
    user: string;
    password: string;
    connectString: string;
    walletDir: string;
    walletPassword: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  const d = parsed.data;

  // Falhar cedo é melhor do que subir um bot que nunca recebe nada.
  if (d.INGESTION === "telegram" && !d.TELEGRAM_BOT_TOKEN) {
    throw new Error("INGESTION=telegram exige TELEGRAM_BOT_TOKEN.");
  }

  if (d.ANALYZER === "oci") {
    const faltando = (["OCI_COMPARTMENT_ID", "OCI_MODEL_ID", "OCI_REGION"] as const).filter(
      (k) => !d[k],
    );
    if (faltando.length > 0) {
      throw new Error(`ANALYZER=oci exige: ${faltando.join(", ")}.`);
    }
  }

  if (d.STORE === "oracle") {
    const faltando = (
      ["ORACLE_USER", "ORACLE_PASSWORD", "ORACLE_CONNECT_STRING"] as const
    ).filter((k) => !d[k]);
    if (faltando.length > 0) {
      throw new Error(`STORE=oracle exige: ${faltando.join(", ")}.`);
    }
  }

  return {
    port: d.PORT,
    host: d.HOST,
    logLevel: d.LOG_LEVEL,
    corsOrigins: d.CORS_ORIGINS.split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
    apiKey: d.GUARDIAN_API_KEY,
    ingestion: d.INGESTION,
    analyzer: d.ANALYZER,
    store: d.STORE,
    childName: d.CHILD_NAME,
    batchIntervalMs: d.BATCH_INTERVAL_MS,
    contextBatches: d.CONTEXT_BATCHES,
    oracle: {
      user: d.ORACLE_USER,
      password: d.ORACLE_PASSWORD,
      connectString: d.ORACLE_CONNECT_STRING,
      walletDir: d.ORACLE_WALLET_DIR,
      walletPassword: d.ORACLE_WALLET_PASSWORD,
    },
  };
}

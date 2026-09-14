/**
 * DIANA guardian-api — configuração de ambiente (validada por zod).
 *
 * Fonte única de verdade da configuração do serviço. Todas as variáveis têm
 * default seguro para a DEMO (modo `fixtures`, sem credenciais, sem auth).
 * Ver `.env.example` para a documentação de cada variável.
 */
import { z } from "zod";

/** Fonte de leitura de alertas. */
export const ALERTS_SOURCES = ["fixtures", "file", "oci"] as const;
export type AlertsSource = (typeof ALERTS_SOURCES)[number];

/** Backend de escrita (feedback + settings). */
export const WRITE_BACKENDS = ["memory", "file", "oci"] as const;
export type WriteBackend = (typeof WRITE_BACKENDS)[number];

const csv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const rawSchema = z.object({
  // --- servidor HTTP ---
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // --- fonte de alertas ---
  ALERTS_SOURCE: z.enum(ALERTS_SOURCES).default("fixtures"),
  // No monorepo o núcleo grava em `<raiz>/demo-state` (ver `npm run seed`).
  STATE_DIR: z.string().min(1).default("../../demo-state"),
  OCI_OS_BUCKET: z.string().default("diana-monitoring"),
  OCI_OS_NAMESPACE: z.string().default(""),
  OCI_OS_REGION: z.string().default(""),

  // --- persistência de escrita ---
  // Vazio => segue ALERTS_SOURCE (mapeado no refino abaixo).
  WRITE_BACKEND: z.enum(WRITE_BACKENDS).optional(),

  // --- autenticação (MVP: sem auth) ---
  GUARDIAN_API_KEY: z.string().default(""),
  CORS_ORIGINS: z.string().default("*"),
});

export interface AppConfig {
  port: number;
  host: string;
  logLevel: "debug" | "info" | "warn" | "error";
  alertsSource: AlertsSource;
  stateDir: string;
  oci: {
    bucket: string;
    namespace: string;
    region: string;
  };
  writeBackend: WriteBackend;
  /** Vazio = API aberta (só demo). Definido = exige header x-api-key. */
  apiKey: string;
  corsOrigins: string[];
}

/**
 * Quando `WRITE_BACKEND` não é definido, o backend de escrita segue a fonte de
 * alertas: `fixtures` grava em memória (demo), `file`/`oci` persistem no mesmo
 * lugar de onde leem.
 */
function defaultWriteBackend(source: AlertsSource): WriteBackend {
  return source === "fixtures" ? "memory" : source;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  const data = parsed.data;
  const alertsSource = data.ALERTS_SOURCE;
  const writeBackend = data.WRITE_BACKEND ?? defaultWriteBackend(alertsSource);

  return {
    port: data.PORT,
    host: data.HOST,
    logLevel: data.LOG_LEVEL,
    alertsSource,
    stateDir: data.STATE_DIR,
    oci: {
      bucket: data.OCI_OS_BUCKET,
      namespace: data.OCI_OS_NAMESPACE,
      region: data.OCI_OS_REGION,
    },
    writeBackend,
    apiKey: data.GUARDIAN_API_KEY,
    corsOrigins: csv(data.CORS_ORIGINS),
  };
}

/**
 * Bootstrap do backend da DIANA.
 *
 * Monta a cadeia completa e sobe o servidor:
 *
 *   fonte (Telegram|fixtures)
 *        ↓ mensagem a mensagem
 *   BatchScheduler        a cada N segundos, fecha um batch e PERSISTE
 *        ↓ últimos 3 batches como contexto
 *   analisador (OCI|heurística)
 *        ↓ veredito
 *   alertas → API → app do responsável
 *
 * A API sobe antes da ingestão: o app do responsável não deve esperar a nuvem
 * nem o banco para abrir.
 */
import { createAnalyzer } from "./analyzer/index.js";
import { MemoryBatchStore } from "./batch/MemoryBatchStore.js";
import { OracleBatchStore } from "./batch/OracleBatchStore.js";
import { BatchScheduler } from "./batch/scheduler.js";
import type { BatchStore } from "./batch/types.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createServer } from "./http/server.js";
import { createSource } from "./ingestion/index.js";
import { logger } from "./logger.js";
import { createAlertStore } from "./store/AlertStore.js";
import { FeedbackStore, SettingsStore } from "./store/settings.js";

function createBatchStore(config: AppConfig): BatchStore {
  if (config.store !== "oracle") return new MemoryBatchStore();

  return new OracleBatchStore({
    user: config.oracle.user,
    password: config.oracle.password,
    connectString: config.oracle.connectString,
    ...(config.oracle.walletDir ? { walletDir: config.oracle.walletDir } : {}),
    ...(config.oracle.walletPassword ? { walletPassword: config.oracle.walletPassword } : {}),
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  const analyzer = createAnalyzer();
  const alerts = createAlertStore();
  const batches = createBatchStore(config);
  const source = createSource();

  const scheduler = new BatchScheduler({
    analyzer,
    batches,
    alerts,
    intervalMs: config.batchIntervalMs,
    contextBatches: config.contextBatches,
  });

  const app = createServer(config, {
    alerts,
    feedback: new FeedbackStore(),
    settings: new SettingsStore(),
    scheduler,
    ingestion: source.name,
    analyzer: analyzer.name,
  });

  await app.listen({ port: config.port, host: config.host });
  logger.info(
    `DIANA backend em http://${config.host}:${config.port} ` +
      `(ingestão=${source.name}, análise=${analyzer.name}, ` +
      `batches=${batches.name}, alertas=${config.store}, ` +
      `auth=${config.apiKey ? "x-api-key" : "aberta"})`,
  );

  // O banco pode demorar ou falhar; a API já está no ar quando isso acontece.
  try {
    await batches.init();
  } catch (err) {
    logger.error("Falha ao preparar o armazenamento de batches", err);
    throw err;
  }

  scheduler.start();

  source.start((message) => scheduler.accept(message)).catch((err) => {
    logger.error("Falha na ingestão", err);
  });

  const shutdown = (signal: string) => {
    logger.info(`Recebido ${signal}, encerrando…`);
    void source
      .stop()
      // Fecha o batch pendente antes de sair: mensagem recebida não se perde.
      .then(() => scheduler.stop())
      .then(() => batches.close())
      .then(() => app.close())
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("Erro fatal no bootstrap", err);
  process.exit(1);
});

import { createAnalyzer } from "./analyzer/index.js";
import { MemoryBatchStore } from "./batch/MemoryBatchStore.js";
import { OracleBatchStore } from "./batch/OracleBatchStore.js";
import { BatchScheduler } from "./batch/scheduler.js";
import type { BatchStore } from "./batch/types.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createServer } from "./http/server.js";
import { createSource } from "./ingestion/index.js";
import { logger } from "./logger.js";
import { createAlertStore, hasLifecycle } from "./store/AlertStore.js";
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
    // STORE=oracle: sem isto o pool nunca abre e todo save() falharia.
    if (hasLifecycle(alerts)) await alerts.init();
  } catch (err) {
    logger.error("Falha ao preparar o armazenamento", err);
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
      .then(() => (hasLifecycle(alerts) ? alerts.close() : undefined))
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

/**
 * Bootstrap do backend da DIANA.
 *
 * Monta a cadeia completa — ingestão -> análise -> alertas -> API — e sobe o
 * servidor. A ingestão roda em paralelo ao HTTP: com `fixtures` termina rápido;
 * com `telegram` fica em long polling enquanto o processo viver.
 */
import { createAnalyzer } from "./analyzer/index.js";
import { loadConfig } from "./config/env.js";
import { createServer } from "./http/server.js";
import { createSource } from "./ingestion/index.js";
import { logger } from "./logger.js";
import { Pipeline } from "./pipeline.js";
import { createAlertStore } from "./store/AlertStore.js";
import { FeedbackStore, SettingsStore } from "./store/settings.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const analyzer = createAnalyzer();
  const alerts = createAlertStore();
  const pipeline = new Pipeline(analyzer, alerts);
  const source = createSource();

  const app = createServer(config, {
    alerts,
    feedback: new FeedbackStore(),
    settings: new SettingsStore(),
    pipeline,
    ingestion: source.name,
    analyzer: analyzer.name,
  });

  // A API sobe primeiro: o app do responsável não deve esperar a ingestão.
  await app.listen({ port: config.port, host: config.host });
  logger.info(
    `DIANA backend em http://${config.host}:${config.port} ` +
      `(ingestão=${source.name}, análise=${analyzer.name}, ` +
      `alertas=${config.store}, auth=${config.apiKey ? "x-api-key" : "aberta"})`,
  );

  pipeline.connect(source).catch((err) => {
    logger.error("Falha na ingestão", err);
  });

  const shutdown = (signal: string) => {
    logger.info(`Recebido ${signal}, encerrando…`);
    void source
      .stop()
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

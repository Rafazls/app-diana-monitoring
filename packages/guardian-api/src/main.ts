/**
 * DIANA guardian-api — bootstrap.
 *
 * Carrega a config, monta o servidor e escuta em `PORT`/`HOST`. É um servidor
 * de LONGA DURAÇÃO (≠ núcleo, que roda `--once`): 1 Container Instance simples
 * na OCI, com `GET /health` para readiness/liveness (§2.5).
 */
import { loadConfig } from "./config/env.js";
import { createServer } from "./http/server.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createServer(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(
      `guardian-api ouvindo em http://${config.host}:${config.port} ` +
        `(fonte=${config.alertsSource}, escrita=${config.writeBackend}, ` +
        `auth=${config.apiKey ? "x-api-key" : "aberta"})`,
    );
  } catch (err) {
    logger.error("Falha ao iniciar o servidor", err);
    process.exit(1);
  }
}

const shutdown = (signal: string) => {
  logger.info(`Recebido ${signal}, encerrando…`);
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  logger.error("Erro fatal no bootstrap", err);
  process.exit(1);
});

/**
 * `npm run seed` — roda o pipeline uma vez e imprime o que aconteceu.
 *
 * É o passo que "liga" a demo: sem ele o `guardian-api` não tem o que servir.
 * A saída mostra conversa por conversa, inclusive as descartadas, para deixar
 * visível que o sistema filtra em vez de alertar sobre tudo.
 */
import path from "node:path";
import { createAnalyzer } from "@diana/analyzer";
import { FileAlertStore } from "./alertStore.js";
import { demoConversations } from "./fixtures/conversations.js";
import { runPipeline } from "./pipeline.js";

const STATE_DIR = process.env.STATE_DIR ?? path.resolve(process.cwd(), "demo-state");

function icon(alerted: boolean): string {
  return alerted ? "🚨" : "✅";
}

async function main(): Promise<void> {
  const analyzer = createAnalyzer();
  const store = new FileAlertStore(STATE_DIR);

  console.log(`\nDIANA · núcleo — analisando ${demoConversations.length} conversas`);
  console.log(`motor: ${analyzer.name}  |  estado: ${STATE_DIR}\n`);

  const result = await runPipeline({ conversations: demoConversations, analyzer, store });

  for (const outcome of result.outcomes) {
    const head = `${icon(outcome.alerted)} ${outcome.childName} ↔ ${outcome.contactName}`;
    const detail = `score ${String(outcome.score).padStart(3)}/100 · ${outcome.level} · ${outcome.signalCount} sinal(is)`;
    console.log(`${head.padEnd(42)} ${detail}`);
  }

  console.log(
    `\n${result.alerted} alerta(s) gerado(s), ${result.discarded} conversa(s) descartada(s) sem risco relevante.`,
  );
  console.log(`Alertas gravados em: ${path.join(STATE_DIR, "alerts")}\n`);
}

main().catch((err) => {
  console.error("Falha ao rodar o pipeline:", err);
  process.exit(1);
});

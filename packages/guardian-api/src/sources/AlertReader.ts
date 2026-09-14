/**
 * DIANA guardian-api — interface de LEITURA de alertas (read-only, §5.2).
 *
 * Implementações (selecionadas por `ALERTS_SOURCE`):
 *   - FixtureAlertReader  (default / demo)
 *   - FileAlertReader     (dev / integração local com o STATE_DIR do núcleo)
 *   - OciObjectStorageAlertReader (produção MVP — PR-11)
 */
import type { AlertRecord } from "../contracts/index.js";

export interface AlertReader {
  /** Todos os alertas conhecidos (o chamador ordena/pagina). */
  listAlerts(): Promise<AlertRecord[]>;

  /** Um alerta por (conversationId, processedAt); `null` se inexistente. */
  getAlert(conversationId: string, processedAt: string): Promise<AlertRecord | null>;

  /**
   * Nome da criança para um `conversationId`, quando a fonte souber (§6.4).
   * O `AnalysisResult` não carrega `childName`; fontes reais devolvem
   * `undefined` (a UI usa o fallback "Criança"). As fixtures conhecem o nome.
   */
  resolveChildName?(conversationId: string): string | undefined;
}

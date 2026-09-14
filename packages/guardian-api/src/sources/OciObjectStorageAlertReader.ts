/**
 * DIANA guardian-api — leitor de alertas do OCI Object Storage (produção MVP).
 *
 * 🚧 PLACEHOLDER (PR-11). A dependência `oci-sdk` é isolada e ainda NÃO entra
 * no MVP inicial (a demo roda com `ALERTS_SOURCE=fixtures`). Este stub existe
 * para manter o `seam` da fonte de dados: quando o backend `oci` for
 * implementado, `listObjects(prefix="alerts/")` + `getObject` no bucket entram
 * aqui — ADIÇÃO, não reescrita (mesmos métodos da interface `AlertReader`).
 *
 * Selecionar `ALERTS_SOURCE=oci` sem essa implementação falha explicitamente na
 * INICIALIZAÇÃO (o construtor lança) — nunca um `/health` verde enganoso que só
 * quebraria na primeira leitura. Fail-fast no boot, com instrução clara.
 */
import type { AlertRecord } from "../contracts/index.js";
import type { AlertReader } from "./AlertReader.js";

export interface OciObjectStorageConfig {
  bucket: string;
  namespace: string;
  region: string;
}

const NOT_IMPLEMENTED =
  "ALERTS_SOURCE=oci ainda não está implementado neste MVP (ver PR-11 da análise). " +
  "Use ALERTS_SOURCE=fixtures (demo) ou ALERTS_SOURCE=file (dev com o STATE_DIR do núcleo).";

export class OciObjectStorageAlertReader implements AlertReader {
  constructor(_config: OciObjectStorageConfig) {
    // Fail-fast no boot (alinhado ao comentário acima): não sobe um servidor
    // que responderia /health mas quebraria na primeira leitura.
    throw new Error(NOT_IMPLEMENTED);
  }

  async listAlerts(): Promise<AlertRecord[]> {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getAlert(_conversationId: string, _processedAt: string): Promise<AlertRecord | null> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

/**
 * DIANA — `AlertRecord` persistido pelo núcleo (`app-diana-monitoring`).
 *
 * Cópia idêntica de
 * `app-diana-monitoring/src/state/checkpoint.ts` (apenas o `AlertRecord`).
 * É o registro que o núcleo grava no Object Storage em
 * `alerts/<conversationId>/<processedAt>.json` e que ESTE serviço apenas LÊ.
 *
 * 🧊 RF-16 / privacy by design: nunca contém a conversa integral — só o
 * `AnalysisResult` agregado.
 *
 * Regra de sincronização: quando o pacote `@diana/contracts` for publicado,
 * substituir `src/contracts/` pela dependência e remover esta cópia.
 */
import type { AnalysisResult } from "./types.js";

export interface AlertRecord {
  conversationId: string;
  /** ISO 8601. */
  processedAt: string;
  result: AnalysisResult;
}

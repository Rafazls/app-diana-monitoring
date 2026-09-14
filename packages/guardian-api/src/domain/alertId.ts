/**
 * DIANA guardian-api — `alertId` (chave estável do alerta).
 *
 * O alerta é identificado por (`conversationId`, `processedAt`). Para caber
 * numa rota `GET /alerts/{id}`, codificamos os dois num id reversível
 * (§6.3 da análise):
 *
 *   alertId = base64url("<conversationId>|<processedAt>")
 *
 * A codificação é reversível e sem colisão (o separador `|` não aparece nos
 * componentes). `decodeAlertId` valida a estrutura e devolve `null` para ids
 * malformados (a rota responde 400).
 */

const SEPARATOR = "|";

export interface AlertRef {
  conversationId: string;
  processedAt: string;
}

export function encodeAlertId(conversationId: string, processedAt: string): string {
  if (conversationId.includes(SEPARATOR) || processedAt.includes(SEPARATOR)) {
    throw new Error(`conversationId/processedAt não podem conter o separador "${SEPARATOR}"`);
  }
  const payload = `${conversationId}${SEPARATOR}${processedAt}`;
  return Buffer.from(payload, "utf-8").toString("base64url");
}

export function decodeAlertId(alertId: string): AlertRef | null {
  if (typeof alertId !== "string" || alertId.length === 0) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(alertId, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const index = decoded.indexOf(SEPARATOR);
  if (index <= 0 || index === decoded.length - 1) return null;

  const conversationId = decoded.slice(0, index);
  const processedAt = decoded.slice(index + 1);
  if (conversationId.length === 0 || processedAt.length === 0) return null;

  return { conversationId, processedAt };
}

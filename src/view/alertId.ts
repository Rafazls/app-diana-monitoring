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

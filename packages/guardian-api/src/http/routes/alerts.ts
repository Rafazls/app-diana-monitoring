/**
 * DIANA guardian-api — rotas de alertas (§7.1, §7.2).
 *   GET /alerts        -> lista de `AlertSummary` (resumo), ordenada desc.
 *   GET /alerts/:id     -> `AlertView` (detalhe resumido). 400/404.
 *
 * Robustez (hardening): a lista é TOLERANTE A FALHA POR ITEM — um registro que
 * falhe ao resumir é logado e pulado, servindo os demais (nunca 500 tudo-ou-
 * nada). Falha ao LER a fonte (I/O, fonte indisponível) responde 503 previsível.
 */
import type { FastifyInstance } from "fastify";
import type { AlertRecord } from "../../contracts/index.js";
import { decodeAlertId } from "../../domain/alertId.js";
import { toAlertSummary, toAlertView } from "../../domain/summarize.js";
import type { AlertSummary } from "../../domain/viewTypes.js";
import type { AppDeps } from "../deps.js";
import { alertsQuerySchema } from "../validation.js";

/** Tamanho de página default quando `limit` não é informado (evita resposta ilimitada). */
const DEFAULT_PAGE_SIZE = 50;

/** Cursor de paginação simples: offset codificado em base64url. */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf-8").toString("base64url");
}

/**
 * Decodifica o cursor. Ausente => offset 0. Presente porém inválido => `null`
 * (o cursor é gerado pela própria API, então um valor não decodificável é erro
 * do cliente => 400, em vez de re-servir silenciosamente a página 1).
 */
function decodeCursor(cursor: string | undefined): number | null {
  if (cursor === undefined || cursor === "") return 0;
  const raw = Buffer.from(cursor, "base64url").toString("utf-8");
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function registerAlertRoutes(app: FastifyInstance, deps: AppDeps): void {
  const childName = (conversationId: string): string | undefined =>
    deps.reader.resolveChildName?.(conversationId);

  app.get("/alerts", async (request, reply) => {
    const parsed = alertsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    const { priority, category, limit, cursor } = parsed.data;

    const start = decodeCursor(cursor);
    if (start === null) {
      return reply.code(400).send({ error: "bad_request", message: "cursor inválido." });
    }

    // Falha ao ler a fonte (I/O, fonte indisponível) -> 503 previsível.
    let records: AlertRecord[];
    try {
      records = await deps.reader.listAlerts();
    } catch (err) {
      request.log.error({ err }, "Falha ao ler a fonte de alertas");
      return reply
        .code(503)
        .send({ error: "source_unavailable", message: "Fonte de alertas indisponível." });
    }

    // Projeção tolerante a falha por item: pula (logando) o registro problemático.
    const items: AlertSummary[] = [];
    for (const record of records) {
      try {
        items.push(toAlertSummary(record, { childName: childName(record.conversationId) }));
      } catch (err) {
        request.log.warn(
          { err, conversationId: record.conversationId },
          "Alerta ignorado ao resumir",
        );
      }
    }

    // Ordena por detectedAt desc (mais recente primeiro).
    items.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));

    let filtered = items;
    if (priority) filtered = filtered.filter((item) => item.priority === priority);
    if (category) {
      const needle = category.toLowerCase();
      filtered = filtered.filter((item) => item.category.toLowerCase().includes(needle));
    }

    // Paginação simples (offset/cursor).
    const pageSize = limit ?? DEFAULT_PAGE_SIZE;
    const page = filtered.slice(start, start + pageSize);
    const nextOffset = start + page.length;
    const nextCursor = nextOffset < filtered.length ? encodeCursor(nextOffset) : undefined;

    return reply.send({ items: page, ...(nextCursor ? { nextCursor } : {}) });
  });

  app.get<{ Params: { id: string } }>("/alerts/:id", async (request, reply) => {
    const ref = decodeAlertId(request.params.id);
    if (!ref) {
      return reply.code(400).send({ error: "bad_request", message: "alertId malformado." });
    }

    let record: AlertRecord | null;
    try {
      record = await deps.reader.getAlert(ref.conversationId, ref.processedAt);
    } catch (err) {
      request.log.error({ err }, "Falha ao ler a fonte de alertas");
      return reply
        .code(503)
        .send({ error: "source_unavailable", message: "Fonte de alertas indisponível." });
    }
    if (!record) {
      return reply.code(404).send({ error: "not_found", message: "Alerta não encontrado." });
    }

    return reply.send(toAlertView(record, { childName: childName(record.conversationId) }));
  });
}

/**
 * Rotas que o app do responsável consome.
 *
 * Cada rota devolve exatamente a forma que a tela espera — o front não faz
 * conta nem remonta dado. Erros são previsíveis: 400 entrada inválida,
 * 404 alerta inexistente, 503 fonte indisponível.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AlertRecord } from "../contracts/index.js";
import { logger } from "../logger.js";
import type { BatchScheduler } from "../batch/scheduler.js";
import type { AlertStore } from "../store/AlertStore.js";
import type { FeedbackStore, SettingsStore } from "../store/settings.js";
import { decodeAlertId } from "../view/alertId.js";
import { toAlertDetail, toAlertItem } from "../view/project.js";
import type { ActivityPoint, AlertItem, DashboardStat } from "../view/types.js";

export interface Deps {
  alerts: AlertStore;
  feedback: FeedbackStore;
  settings: SettingsStore;
  scheduler: BatchScheduler;
  ingestion: string;
  analyzer: string;
}

const feedbackBodySchema = z.object({
  verdict: z.enum(["useful", "false_positive", "not_sure"]),
  note: z.string().max(2000).optional(),
});

const settingsBodySchema = z.object({
  sections: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      items: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string(),
          enabled: z.boolean(),
        }),
      ),
    }),
  ),
});

/** Ordena do mais recente para o mais antigo. */
function byNewest(a: AlertRecord, b: AlertRecord): number {
  return b.processedAt.localeCompare(a.processedAt);
}

/**
 * Projeta a lista, pulando (e logando) o registro que falhar. Um alerta
 * problemático não pode derrubar a lista inteira do responsável.
 */
function projectList(records: AlertRecord[], store: AlertStore): AlertItem[] {
  const items: AlertItem[] = [];
  for (const record of records) {
    try {
      items.push(
        toAlertItem(record, {
          ...(store.childName(record.conversationId) !== undefined
            ? { childName: store.childName(record.conversationId) }
            : {}),
          read: store.isRead(record.conversationId, record.processedAt),
        }),
      );
    } catch (err) {
      logger.warn(`Alerta ignorado ao projetar (${record.conversationId}): ${String(err)}`);
    }
  }
  return items;
}

/** Série dos últimos 7 dias: mensagens analisadas e alertas, por dia. */
function buildActivity(
  records: AlertRecord[],
  messagesByDay: Record<string, number>,
): ActivityPoint[] {
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const today = new Date();
  const points: ActivityPoint[] = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const next = new Date(day.getTime() + 86_400_000);

    const alertasDoDia = records.filter((record) => {
      const at = Date.parse(record.processedAt);
      return at >= day.getTime() && at < next.getTime();
    }).length;

    const month = String(day.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(day.getDate()).padStart(2, "0");
    const key = `${day.getFullYear()}-${month}-${dayOfMonth}`;

    points.push({
      day: dayNames[day.getDay()] ?? "",
      mensagens: messagesByDay[key] ?? 0,
      alertas: alertasDoDia,
    });
  }

  return points;
}

function buildStats(records: AlertRecord[], items: AlertItem[], analyzed: number): DashboardStat[] {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const hoje = records.filter((r) => Date.parse(r.processedAt) >= startOfToday).length;
  const altas = items.filter((i) => i.priority === "alta").length;
  const medias = items.filter((i) => i.priority === "media").length;

  return [
    {
      id: "conversations",
      label: "Conversas analisadas",
      value: String(analyzed),
      hint: analyzed === 1 ? "1 conversa" : `${analyzed} conversas`,
    },
    {
      id: "alerts-today",
      label: "Alertas hoje",
      value: String(hoje),
      hint: `${medias} médios · ${altas} altos`,
    },
    {
      id: "high-priority",
      label: "Alta prioridade",
      value: String(altas),
      hint: altas > 0 ? "requer atenção" : "nada crítico",
    },
    {
      id: "tracked",
      label: "Situações acompanhadas",
      value: String(items.length),
      hint: "em monitoramento",
    },
  ];
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  app.get("/health", async () => {
    const stats = deps.scheduler.getStats();
    return {
      status: "ok",
      ingestion: deps.ingestion,
      analyzer: deps.analyzer,
      ...stats,
      uptime: Math.round(process.uptime()),
    };
  });

  app.get("/dashboard", async (request, reply) => {
    let records: AlertRecord[];
    try {
      records = (await deps.alerts.list()).sort(byNewest);
    } catch (err) {
      request.log.error({ err }, "Falha ao ler os alertas");
      return reply
        .code(503)
        .send({ error: "source_unavailable", message: "Fonte de alertas indisponível." });
    }

    const items = projectList(records, deps.alerts);
    const stats = deps.scheduler.getStats();

    return reply.send({
      stats: buildStats(records, items, stats.analyzed),
      activity: buildActivity(records, stats.messagesByDay),
      recentAlerts: items.slice(0, 5),
    });
  });

  app.get("/alerts", async (request, reply) => {
    let records: AlertRecord[];
    try {
      records = (await deps.alerts.list()).sort(byNewest);
    } catch (err) {
      request.log.error({ err }, "Falha ao ler os alertas");
      return reply
        .code(503)
        .send({ error: "source_unavailable", message: "Fonte de alertas indisponível." });
    }
    return reply.send(projectList(records, deps.alerts));
  });

  app.get<{ Params: { id: string } }>("/alerts/:id", async (request, reply) => {
    const ref = decodeAlertId(request.params.id);
    if (!ref) {
      return reply.code(400).send({ error: "bad_request", message: "alertId malformado." });
    }

    let record: AlertRecord | null;
    try {
      record = await deps.alerts.get(ref.conversationId, ref.processedAt);
    } catch (err) {
      request.log.error({ err }, "Falha ao ler o alerta");
      return reply
        .code(503)
        .send({ error: "source_unavailable", message: "Fonte de alertas indisponível." });
    }

    if (!record) {
      return reply.code(404).send({ error: "not_found", message: "Alerta não encontrado." });
    }

    // Abrir o detalhe marca como lido — é o que apaga o badge na lista.
    deps.alerts.markRead(ref.conversationId, ref.processedAt);

    const childName = deps.alerts.childName(ref.conversationId);
    return reply.send(toAlertDetail(record, childName !== undefined ? { childName } : {}));
  });

  app.post<{ Params: { id: string } }>("/alerts/:id/feedback", async (request, reply) => {
    const ref = decodeAlertId(request.params.id);
    if (!ref) {
      return reply.code(400).send({ error: "bad_request", message: "alertId malformado." });
    }

    const parsed = feedbackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }

    const record = await deps.alerts.get(ref.conversationId, ref.processedAt);
    if (!record) {
      return reply.code(404).send({ error: "not_found", message: "Alerta não encontrado." });
    }

    return reply.code(201).send(
      deps.feedback.save({
        alertId: request.params.id,
        verdict: parsed.data.verdict,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        createdAt: new Date().toISOString(),
      }),
    );
  });

  app.get("/settings", async (_request, reply) => reply.send(deps.settings.get()));

  app.put("/settings", async (request, reply) => {
    const parsed = settingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request", issues: parsed.error.issues });
    }
    return reply.send(deps.settings.put(parsed.data));
  });
}

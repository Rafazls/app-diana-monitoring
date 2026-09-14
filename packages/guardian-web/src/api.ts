/**
 * Cliente HTTP tipado da `guardian-api`.
 *
 * Os tipos vêm de `@diana/contracts` — os MESMOS que a API usa para montar a
 * resposta. Se o contrato mudar, o `typecheck` quebra aqui antes de a tela
 * quebrar na frente do responsável.
 *
 * Importação só de tipo: nada de `@diana/contracts` vai para o bundle.
 */
import type {
  AlertSummary,
  AlertView,
  FeedbackRecord,
  FeedbackVerdict,
  GuardianPriority,
  GuardianSettings,
} from "@diana/contracts";

const BASE = "/api";

/** Erro com a mensagem já traduzida para algo que o responsável entende. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mensagens por status — a API responde 400/404/503 de forma previsível. */
function friendlyMessage(status: number, payload: unknown): string {
  if (status === 503) return "A fonte de alertas está indisponível no momento.";
  if (status === 404) return "Alerta não encontrado.";
  if (status === 400) return "Requisição inválida.";
  const message =
    typeof payload === "object" && payload !== null && "message" in payload
      ? String((payload as { message: unknown }).message)
      : "";
  return message || `Falha na comunicação com a API (HTTP ${status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // Rede/API fora do ar: falha explícita, não tela vazia.
    throw new ApiError("Não foi possível falar com a API. Ela está rodando?", 0);
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(friendlyMessage(response.status, payload), response.status);
  return payload as T;
}

export interface AlertsPage {
  items: AlertSummary[];
  nextCursor?: string;
}

export const api = {
  listAlerts(filters: { priority?: GuardianPriority; limit?: number } = {}): Promise<AlertsPage> {
    const query = new URLSearchParams();
    if (filters.priority) query.set("priority", filters.priority);
    if (filters.limit) query.set("limit", String(filters.limit));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<AlertsPage>(`/alerts${suffix}`);
  },

  getAlert(id: string): Promise<AlertView> {
    return request<AlertView>(`/alerts/${encodeURIComponent(id)}`);
  },

  sendFeedback(id: string, verdict: FeedbackVerdict, note?: string): Promise<FeedbackRecord> {
    return request<FeedbackRecord>(`/alerts/${encodeURIComponent(id)}/feedback`, {
      method: "POST",
      body: JSON.stringify(note ? { verdict, note } : { verdict }),
    });
  },

  getSettings(): Promise<GuardianSettings> {
    return request<GuardianSettings>("/settings");
  },

  putSettings(settings: GuardianSettings): Promise<GuardianSettings> {
    return request<GuardianSettings>("/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  },
};

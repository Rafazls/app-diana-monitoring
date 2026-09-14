import { useState } from "react";
import type { AlertSummary, GuardianPriority } from "@diana/contracts";
import { EmptyState } from "./States.js";
import { PRIORITY_LABEL, formatDate } from "./shared.js";

const FILTERS: Array<{ id: GuardianPriority | "todas"; label: string }> = [
  { id: "todas", label: "Todas" },
  { id: "alta", label: "Alta" },
  { id: "media", label: "Média" },
  { id: "baixa", label: "Baixa" },
];

export function AlertCard({ alert, onOpen }: { alert: AlertSummary; onOpen: (id: string) => void }) {
  return (
    <button className="card card--alert" onClick={() => onOpen(alert.id)} type="button">
      <div className="card__top">
        <span className={`pill pill--${alert.priority}`}>{PRIORITY_LABEL[alert.priority]}</span>
        <span className="card__date">{formatDate(alert.detectedAt)}</span>
      </div>
      <h3 className="card__title">{alert.category}</h3>
      <p className="card__meta">
        {alert.childName} · score {alert.score}/100
      </p>
    </button>
  );
}

export function AlertsList({
  alerts,
  onOpen,
}: {
  alerts: AlertSummary[];
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<GuardianPriority | "todas">("todas");
  const visible = filter === "todas" ? alerts : alerts.filter((a) => a.priority === filter);

  return (
    <section>
      <div className="filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={`chip ${filter === item.id ? "chip--active" : ""}`}
            onClick={() => setFilter(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState message="Nenhum alerta com esse filtro." />
      ) : (
        <div className="list">
          {visible.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

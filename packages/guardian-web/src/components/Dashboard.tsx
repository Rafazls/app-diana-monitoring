import type { AlertSummary } from "@diana/contracts";
import { AlertCard } from "./AlertsList.js";
import { EmptyState } from "./States.js";

export function Dashboard({
  alerts,
  onOpen,
  onSeeAll,
}: {
  alerts: AlertSummary[];
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}) {
  const needingAttention = alerts.filter((a) => a.requiresGuardianAttention);
  const high = alerts.filter((a) => a.priority === "alta").length;

  // Mais recentes primeiro — a API já ordena, mas a tela não depende disso.
  const recent = [...alerts]
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    .slice(0, 3);

  return (
    <section>
      <div className="stats">
        <div className="stat">
          <span className="stat__value">{alerts.length}</span>
          <span className="stat__label">alertas</span>
        </div>
        <div className="stat stat--attention">
          <span className="stat__value">{needingAttention.length}</span>
          <span className="stat__label">pedem atenção</span>
        </div>
        <div className="stat stat--high">
          <span className="stat__value">{high}</span>
          <span className="stat__label">prioridade alta</span>
        </div>
      </div>

      {alerts.length === 0 ? (
        <EmptyState message="Nenhum alerta por aqui. Isso é uma boa notícia." />
      ) : (
        <>
          <div className="section__head">
            <h2 className="section__title">Mais recentes</h2>
            <button className="link" onClick={onSeeAll} type="button">
              ver todos
            </button>
          </div>
          <div className="list">
            {recent.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onOpen={onOpen} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

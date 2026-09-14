import { useCallback, useEffect, useState } from "react";
import type { AlertSummary, AlertView, GuardianSettings } from "@diana/contracts";
import { ApiError, api } from "./api.js";
import { AlertDetail } from "./components/AlertDetail.js";
import { AlertsList } from "./components/AlertsList.js";
import { Dashboard } from "./components/Dashboard.js";
import { SafetyCenter } from "./components/SafetyCenter.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { ErrorState, Loading } from "./components/States.js";

type Tab = "dashboard" | "alertas" | "ajustes" | "seguranca";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Início" },
  { id: "alertas", label: "Alertas" },
  { id: "ajustes", label: "Ajustes" },
  { id: "seguranca", label: "Apoio" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [alerts, setAlerts] = useState<AlertSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AlertView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GuardianSettings | null>(null);

  const loadAlerts = useCallback(async () => {
    setError(null);
    setAlerts(null);
    try {
      const page = await api.listAlerts();
      setAlerts(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha inesperada ao carregar alertas.");
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  useEffect(() => {
    if (tab !== "ajustes" || settings) return;
    api
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [tab, settings]);

  const openAlert = useCallback(async (id: string) => {
    setDetailError(null);
    try {
      setSelected(await api.getAlert(id));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "Falha ao abrir o alerta.");
    }
  }, []);

  /**
   * Trocar de aba fecha o detalhe. Sem isso as abas ficam visíveis porém
   * inertes enquanto um alerta está aberto — o clique parece quebrado.
   */
  const goToTab = useCallback((next: Tab) => {
    setSelected(null);
    setDetailError(null);
    setTab(next);
  }, []);

  // O detalhe é uma "camada" sobre a navegação — voltar devolve à lista.
  if (selected) {
    return (
      <Shell tab={tab} onTab={goToTab}>
        <AlertDetail alert={selected} onBack={() => setSelected(null)} />
      </Shell>
    );
  }

  return (
    <Shell tab={tab} onTab={goToTab}>
      {detailError && <ErrorState message={detailError} onRetry={() => setDetailError(null)} />}

      {tab === "dashboard" &&
        (error ? (
          <ErrorState message={error} onRetry={loadAlerts} />
        ) : alerts === null ? (
          <Loading />
        ) : (
          <Dashboard alerts={alerts} onOpen={openAlert} onSeeAll={() => setTab("alertas")} />
        ))}

      {tab === "alertas" &&
        (error ? (
          <ErrorState message={error} onRetry={loadAlerts} />
        ) : alerts === null ? (
          <Loading />
        ) : (
          <AlertsList alerts={alerts} onOpen={openAlert} />
        ))}

      {tab === "ajustes" && <SettingsPanel settings={settings} onSaved={setSettings} />}

      {tab === "seguranca" && <SafetyCenter />}
    </Shell>
  );
}

function Shell({
  tab,
  onTab,
  children,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1 className="app__title">DIANA</h1>
          <p className="app__subtitle">Painel do responsável</p>
        </div>
        <span className="badge badge--demo">demo</span>
      </header>

      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tabs__item ${tab === item.id ? "tabs__item--active" : ""}`}
            onClick={() => onTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="app__main">{children}</main>

      <footer className="app__footer">
        Você vê o resumo do risco — nunca a conversa do seu filho.
      </footer>
    </div>
  );
}

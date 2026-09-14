import { useState } from "react";
import type { AlertView, FeedbackVerdict } from "@diana/contracts";
import { ApiError, api } from "../api.js";
import { PRIORITY_LABEL, formatDate } from "./shared.js";

const VERDICTS: Array<{ id: FeedbackVerdict; label: string }> = [
  { id: "useful", label: "Foi útil" },
  { id: "false_positive", label: "Falso alarme" },
  { id: "not_sure", label: "Não sei dizer" },
];

const CONTRIBUTION_LABEL: Record<string, string> = {
  high: "peso alto",
  medium: "peso médio",
  low: "peso baixo",
};

export function AlertDetail({ alert, onBack }: { alert: AlertView; onBack: () => void }) {
  const [sent, setSent] = useState<FeedbackVerdict | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  async function sendFeedback(verdict: FeedbackVerdict) {
    setFeedbackError(null);
    try {
      await api.sendFeedback(alert.id, verdict);
      setSent(verdict);
    } catch (err) {
      setFeedbackError(err instanceof ApiError ? err.message : "Não foi possível enviar.");
    }
  }

  return (
    <article className="detail">
      <button className="link" onClick={onBack} type="button">
        ← voltar
      </button>

      <header className="detail__head">
        <span className={`pill pill--${alert.priority}`}>{PRIORITY_LABEL[alert.priority]}</span>
        <h2 className="detail__title">{alert.explanation.summary}</h2>
        <p className="detail__meta">
          {alert.childName} · {formatDate(alert.detectedAt)} · score {alert.score}/100
        </p>
      </header>

      <section className="panel">
        <h3 className="panel__title">Por que este alerta apareceu</h3>
        <p className="panel__text">{alert.rationale}</p>
      </section>

      {alert.signals.length > 0 && (
        <section className="panel">
          <h3 className="panel__title">Sinais identificados</h3>
          <ul className="signals">
            {alert.signals.map((signal) => (
              <li key={signal.id} className={`signal signal--${signal.severity}`}>
                <div className="signal__head">
                  <strong>{signal.title}</strong>
                  <span className="signal__count">
                    {signal.occurrences}× · {Math.round(signal.confidence * 100)}% confiança
                  </span>
                </div>
                <p className="signal__text">{signal.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {alert.explanation.contextualFactors.length > 0 && (
        <section className="panel">
          <h3 className="panel__title">O que pesou na avaliação</h3>
          <ul className="factors">
            {alert.explanation.contextualFactors.map((factor) => (
              <li key={factor.label} className="factor">
                <strong>{factor.label}</strong>
                <span className="factor__weight">
                  {CONTRIBUTION_LABEL[factor.contribution] ?? factor.contribution}
                </span>
                <p className="factor__text">{factor.description}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel panel--actions">
        <h3 className="panel__title">O que você pode fazer</h3>
        <ol className="actions">
          {alert.explanation.recommendedActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
      </section>

      <section className="panel">
        <h3 className="panel__title">Este alerta fez sentido?</h3>
        {sent ? (
          <p className="feedback__done">Obrigado — sua resposta ajuda a melhorar a triagem.</p>
        ) : (
          <div className="feedback">
            {VERDICTS.map((verdict) => (
              <button
                key={verdict.id}
                className="button"
                onClick={() => void sendFeedback(verdict.id)}
                type="button"
              >
                {verdict.label}
              </button>
            ))}
          </div>
        )}
        {feedbackError && <p className="state state--error">{feedbackError}</p>}
      </section>

      <p className="detail__privacy">
        🔒 O conteúdo das mensagens não é exibido aqui — apenas a análise do risco.
      </p>
    </article>
  );
}

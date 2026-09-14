import { useState } from "react";
import type { GuardianSettings } from "@diana/contracts";
import { ApiError, api } from "../api.js";
import { Loading } from "./States.js";

export function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: GuardianSettings | null;
  onSaved: (settings: GuardianSettings) => void;
}) {
  const [draft, setDraft] = useState<GuardianSettings | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const current = draft ?? settings;
  if (!current) return <Loading />;

  function toggle(sectionId: string, itemId: string) {
    if (!current) return;
    setStatus(null);
    setDraft({
      sections: current.sections.map((section) =>
        section.id !== sectionId
          ? section
          : {
              ...section,
              items: section.items.map((item) =>
                item.id === itemId ? { ...item, enabled: !item.enabled } : item,
              ),
            },
      ),
    });
  }

  async function save() {
    if (!current) return;
    setStatus(null);
    try {
      const saved = await api.putSettings(current);
      onSaved(saved);
      setDraft(null);
      setStatus("Preferências salvas.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : "Não foi possível salvar.");
    }
  }

  return (
    <section>
      {current.sections.map((section) => (
        <div key={section.id} className="panel">
          <h3 className="panel__title">{section.title}</h3>
          {section.items.map((item) => (
            <label key={item.id} className="toggle">
              <input
                checked={item.enabled}
                onChange={() => toggle(section.id, item.id)}
                type="checkbox"
              />
              <span>
                <strong>{item.label}</strong>
                <em>{item.description}</em>
              </span>
            </label>
          ))}
        </div>
      ))}

      <div className="settings__save">
        <button className="button button--primary" disabled={!draft} onClick={() => void save()} type="button">
          Salvar
        </button>
        {status && <span className="settings__status">{status}</span>}
      </div>
    </section>
  );
}

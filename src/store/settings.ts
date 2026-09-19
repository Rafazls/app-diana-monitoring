import type { FeedbackRecord, GuardianSettings } from "../view/types.js";

/**
 * Seções padrão — espelham exatamente as da tela do responsável apresentada na
 * landing page (Proteção, Privacidade, Responsável).
 */
export function defaultSettings(): GuardianSettings {
  return {
    sections: [
      {
        id: "protecao",
        title: "Proteção",
        items: [
          {
            id: "alertas-alta",
            label: "Alertas de alta prioridade",
            description: "Notificações imediatas para riscos críticos",
            enabled: true,
          },
          {
            id: "alertas-medios",
            label: "Alertas médios",
            description: "Notificações para riscos moderados",
            enabled: true,
          },
          {
            id: "resumo-diario",
            label: "Resumo diário",
            description: "Resumo das análises enviado todos os dias",
            enabled: false,
          },
        ],
      },
      {
        id: "privacidade",
        title: "Privacidade",
        items: [
          {
            id: "protecao-dados",
            label: "Proteção de dados",
            description: "Criptografia das conversas analisadas",
            enabled: true,
          },
          {
            id: "controle-info",
            label: "Controle de informações",
            description: "Gerencie quais dados a DIANA utiliza",
            enabled: true,
          },
          {
            id: "historico",
            label: "Histórico",
            description: "Guarda local de análises anteriores",
            enabled: false,
          },
        ],
      },
      {
        id: "responsavel",
        title: "Responsável",
        items: [
          {
            id: "perfil",
            label: "Perfil",
            description: "Seus dados de conta e verificação",
            enabled: true,
          },
          {
            id: "crianca",
            label: "Criança vinculada",
            description: "Proteção ativa",
            enabled: true,
          },
          {
            id: "notificacoes",
            label: "Preferências de notificação",
            description: "Canais de alerta (push, e-mail, SMS)",
            enabled: true,
          },
        ],
      },
    ],
  };
}

export class SettingsStore {
  private current: GuardianSettings | null = null;

  get(): GuardianSettings {
    return structuredClone(this.current ?? defaultSettings());
  }

  put(settings: GuardianSettings): GuardianSettings {
    this.current = structuredClone(settings);
    return structuredClone(this.current);
  }
}

export class FeedbackStore {
  private readonly byAlert = new Map<string, FeedbackRecord>();

  /** Idempotente: o último feedback sobre um alerta prevalece. */
  save(record: FeedbackRecord): FeedbackRecord {
    this.byAlert.set(record.alertId, { ...record });
    return { ...record };
  }

  get(alertId: string): FeedbackRecord | null {
    const found = this.byAlert.get(alertId);
    return found ? { ...found } : null;
  }

  count(): number {
    return this.byAlert.size;
  }
}

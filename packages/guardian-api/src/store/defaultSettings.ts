/**
 * DIANA guardian-api — `GuardianSettings` default (§7.4).
 *
 * Espelha as seções do protótipo (`settingsSections`: Proteção, Privacidade,
 * Responsável). No MVP é um documento ÚNICO global (um responsável na demo,
 * sem multiusuário — isso só chega com auth, Fase 2).
 */
import type { GuardianSettings } from "../domain/viewTypes.js";

export function defaultGuardianSettings(): GuardianSettings {
  return {
    sections: [
      {
        id: "protecao",
        title: "Proteção",
        items: [
          {
            id: "alerts_enabled",
            label: "Alertas de risco",
            description: "Receber alertas quando a DIANA identificar risco.",
            enabled: true,
          },
          {
            id: "high_priority_push",
            label: "Prioridade alta em destaque",
            description: "Destacar alertas de prioridade alta no topo da lista.",
            enabled: true,
          },
          {
            id: "weekly_summary",
            label: "Resumo semanal",
            description: "Resumo periódico da atividade e evolução do risco.",
            enabled: false,
          },
        ],
      },
      {
        id: "privacidade",
        title: "Privacidade",
        items: [
          {
            id: "minimized_view",
            label: "Visão minimizada",
            description: "Exibir apenas o resumo do alerta, nunca a conversa integral (RF-16).",
            enabled: true,
          },
          {
            id: "hide_message_refs",
            label: "Ocultar referências de mensagens",
            description: "Mostrar apenas a contagem de ocorrências, sem identificadores.",
            enabled: false,
          },
        ],
      },
      {
        id: "responsavel",
        title: "Responsável",
        items: [
          {
            id: "feedback_prompt",
            label: "Pedir feedback",
            description: "Solicitar avaliação do alerta (útil / falso positivo) após a leitura.",
            enabled: true,
          },
          {
            id: "safety_tips",
            label: "Dicas de segurança",
            description: "Mostrar orientações preventivas no centro de segurança.",
            enabled: true,
          },
        ],
      },
    ],
  };
}

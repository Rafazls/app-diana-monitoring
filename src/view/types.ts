/**
 * Formas servidas ao app do responsável.
 *
 * Batem exatamente com o que os componentes da tela consomem (os mesmos do
 * protótipo da landing page): `AlertItem` na lista, `AlertDetailPayload` no
 * detalhe, `DashboardPayload` no início. É um CONTRATO DE TELA: mudou aqui,
 * mudou lá.
 *
 * 🧊 RF-16: nada aqui carrega texto de mensagem. O detalhe leva o
 * `AnalysisResult` (que já é identity-free) e a identidade vem separada, de
 * quem tem direito de vê-la.
 */
import type { AnalysisResult } from "../contracts/index.js";

/** Prioridade como a tela usa (o contrato interno usa low/medium/high). */
export type ViewPriority = "alta" | "media" | "baixa";

/** Item da lista de alertas. */
export interface AlertItem {
  id: string;
  title: string;
  child: string;
  /** Rótulo relativo já formatado: "Agora", "Ontem", "Seg". */
  time: string;
  priority: ViewPriority;
  read: boolean;
  category: string;
}

/** Detalhe de um alerta. */
export interface AlertDetailPayload {
  analysis: AnalysisResult;
  childName: string;
  detectedTime: string;
}

export interface DashboardStat {
  id: string;
  label: string;
  value: string;
  hint: string;
}

export interface ActivityPoint {
  day: string;
  mensagens: number;
  alertas: number;
}

export interface DashboardPayload {
  stats: DashboardStat[];
  activity: ActivityPoint[];
  recentAlerts: AlertItem[];
}

export type FeedbackVerdict = "useful" | "false_positive" | "not_sure";

export interface FeedbackRecord {
  alertId: string;
  verdict: FeedbackVerdict;
  note?: string;
  createdAt: string;
}

export interface SettingsItem {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface SettingsSection {
  id: string;
  title: string;
  items: SettingsItem[];
}

export interface GuardianSettings {
  sections: SettingsSection[];
}

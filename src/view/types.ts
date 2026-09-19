import type { AnalysisResult } from "../contracts/index.js";

export type ViewPriority = "alta" | "media" | "baixa";

export interface AlertItem {
  id: string;
  title: string;
  child: string;
  time: string;
  priority: ViewPriority;
  read: boolean;
  category: string;
}

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

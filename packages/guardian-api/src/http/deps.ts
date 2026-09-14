/**
 * DIANA guardian-api — dependências injetadas nas rotas.
 */
import type { AppConfig } from "../config/env.js";
import type { AlertReader } from "../sources/index.js";
import type { FeedbackStore, SettingsStore } from "../store/index.js";

export interface AppDeps {
  config: AppConfig;
  reader: AlertReader;
  feedbackStore: FeedbackStore;
  settingsStore: SettingsStore;
}

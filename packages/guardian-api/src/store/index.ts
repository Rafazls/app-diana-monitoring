/**
 * DIANA guardian-api — fábricas dos stores de escrita (feedback + settings).
 *
 * O backend segue `WRITE_BACKEND` (que, por sua vez, segue `ALERTS_SOURCE`
 * quando não definido — ver `config/env.ts`). `oci` é PR-11.
 */
import type { AppConfig } from "../config/env.js";
import { FileFeedbackStore, MemoryFeedbackStore, type FeedbackStore } from "./FeedbackStore.js";
import { FileSettingsStore, MemorySettingsStore, type SettingsStore } from "./SettingsStore.js";

export type { FeedbackStore } from "./FeedbackStore.js";
export type { SettingsStore } from "./SettingsStore.js";

const OCI_NOT_IMPLEMENTED =
  "WRITE_BACKEND=oci ainda não está implementado neste MVP (ver PR-11 da análise). " +
  "Use WRITE_BACKEND=memory (demo) ou WRITE_BACKEND=file (dev com o STATE_DIR do núcleo).";

export function createFeedbackStore(config: AppConfig): FeedbackStore {
  switch (config.writeBackend) {
    case "memory":
      return new MemoryFeedbackStore();
    case "file":
      return new FileFeedbackStore(config.stateDir);
    case "oci":
      throw new Error(OCI_NOT_IMPLEMENTED);
  }
}

export function createSettingsStore(config: AppConfig): SettingsStore {
  switch (config.writeBackend) {
    case "memory":
      return new MemorySettingsStore();
    case "file":
      return new FileSettingsStore(config.stateDir);
    case "oci":
      throw new Error(OCI_NOT_IMPLEMENTED);
  }
}

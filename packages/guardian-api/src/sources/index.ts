/**
 * DIANA guardian-api — fábrica de `AlertReader` a partir da config (§2, A5).
 */
import type { AppConfig } from "../config/env.js";
import type { AlertReader } from "./AlertReader.js";
import { FileAlertReader } from "./FileAlertReader.js";
import { FixtureAlertReader } from "./FixtureAlertReader.js";
import { OciObjectStorageAlertReader } from "./OciObjectStorageAlertReader.js";

export type { AlertReader } from "./AlertReader.js";

export function createAlertReader(config: AppConfig): AlertReader {
  switch (config.alertsSource) {
    case "fixtures":
      return new FixtureAlertReader();
    case "file":
      return new FileAlertReader(config.stateDir);
    case "oci":
      return new OciObjectStorageAlertReader(config.oci);
  }
}

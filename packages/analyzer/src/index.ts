/**
 * `@diana/analyzer` — escolhe o motor de análise a partir do ambiente.
 *
 * Padrão: `mock` (roda em qualquer máquina, sem credencial). Trocar para o
 * motor real é mudar UMA variável — o resto do sistema não percebe.
 */
import { MockRiskAnalyzer } from "./mockAnalyzer.js";
import { OciRiskAnalyzer } from "./ociAnalyzer.js";
import type { RiskAnalyzer } from "./types.js";

export * from "./types.js";
export * from "./features.js";
export { MockRiskAnalyzer } from "./mockAnalyzer.js";
export { OciRiskAnalyzer, type OciAnalyzerConfig } from "./ociAnalyzer.js";

export type AnalyzerKind = "mock" | "oci";

export function createAnalyzer(env: NodeJS.ProcessEnv = process.env): RiskAnalyzer {
  const kind = (env.ANALYZER ?? "mock").toLowerCase() as AnalyzerKind;

  switch (kind) {
    case "mock":
      return new MockRiskAnalyzer();
    case "oci":
      return new OciRiskAnalyzer({
        compartmentId: env.OCI_COMPARTMENT_ID ?? "",
        modelId: env.OCI_MODEL_ID ?? "",
        region: env.OCI_REGION ?? "",
      });
    default:
      throw new Error(`ANALYZER inválido: "${String(kind)}". Use "mock" ou "oci".`);
  }
}

/**
 * Seleção do motor de análise por ambiente.
 *
 * `mock` roda em qualquer máquina, sem credencial; `oci` usa o modelo na nuvem
 * e mantém a heurística como reserva — se a nuvem cair, a conversa ainda é
 * analisada. Trocar de motor é mudar uma variável.
 */
import { EdgeRiskAnalyzer } from "./edgeAnalyzer.js";
import { MockRiskAnalyzer } from "./mockAnalyzer.js";
import { OciRiskAnalyzer, type ModelFamily } from "./ociAnalyzer.js";
import type { RiskAnalyzer } from "./types.js";

export * from "./types.js";
export * from "./features.js";
export * from "./riskEngine.js";
export { MockRiskAnalyzer } from "./mockAnalyzer.js";
export { OciRiskAnalyzer, type OciAnalyzerConfig } from "./ociAnalyzer.js";
export { EdgeRiskAnalyzer, type EdgeAnalyzerConfig } from "./edgeAnalyzer.js";

export type AnalyzerKind = "mock" | "edge" | "oci";

/** A chave privada pode vir em uma linha só, com \n escapado (formato .env). */
function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function createAnalyzer(env: NodeJS.ProcessEnv = process.env): RiskAnalyzer {
  const kind = (env.ANALYZER ?? "mock").toLowerCase() as AnalyzerKind;

  switch (kind) {
    case "mock":
      return new MockRiskAnalyzer();

    case "edge":
      return new EdgeRiskAnalyzer({
        modelPath: env.EDGE_MODEL_PATH ?? "",
        ...(env.EDGE_MODELS_DIR ? { modelsDir: env.EDGE_MODELS_DIR } : {}),
        ...(env.EDGE_CONTEXT_SIZE ? { contextSize: Number(env.EDGE_CONTEXT_SIZE) } : {}),
        ...(env.EDGE_MAX_TOKENS ? { maxTokens: Number(env.EDGE_MAX_TOKENS) } : {}),
        ...(env.EDGE_GPU_LAYERS ? { gpuLayers: Number(env.EDGE_GPU_LAYERS) } : {}),
        // Sem reserva, um modelo que não carrega viraria conversa não analisada.
        fallback: new MockRiskAnalyzer(),
      });

    case "oci":
      return new OciRiskAnalyzer({
        compartmentId: env.OCI_COMPARTMENT_ID ?? "",
        modelId: env.OCI_MODEL_ID ?? "",
        region: env.OCI_REGION ?? "",
        family: ((env.OCI_MODEL_FAMILY ?? "cohere").toLowerCase() as ModelFamily),
        ...(env.OCI_TENANCY_ID ? { tenancyId: env.OCI_TENANCY_ID } : {}),
        ...(env.OCI_USER_ID ? { userId: env.OCI_USER_ID } : {}),
        ...(env.OCI_FINGERPRINT ? { fingerprint: env.OCI_FINGERPRINT } : {}),
        ...(env.OCI_PRIVATE_KEY ? { privateKey: normalizePrivateKey(env.OCI_PRIVATE_KEY) } : {}),
        ...(env.OCI_PASSPHRASE ? { passphrase: env.OCI_PASSPHRASE } : {}),
        ...(env.OCI_TIMEOUT_MS ? { timeoutMs: Number(env.OCI_TIMEOUT_MS) } : {}),
        // Sem reserva, uma instabilidade da nuvem viraria conversa não analisada.
        fallback: new MockRiskAnalyzer(),
      });

    default:
      throw new Error(`ANALYZER inválido: "${String(kind)}". Use "mock" ou "oci".`);
  }
}

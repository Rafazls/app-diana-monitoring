/**
 * `OciRiskAnalyzer` — o lugar reservado para o motor real (OCI Generative AI).
 *
 * 🚧 Ainda NÃO implementado nesta demo, e isso é deliberado: chamar a OCI exige
 * credenciais, SDK e custo por requisição — nada disso deve ser pré-requisito
 * para alguém rodar a demo. O que este arquivo garante é que o *encaixe* já
 * existe: quando o motor real entrar, ele implementa `RiskAnalyzer` e mais
 * nenhum pacote muda de lugar.
 *
 * Escolher `ANALYZER=oci` sem a implementação falha AQUI, no boot, com uma
 * instrução clara — nunca silenciosamente, nem com um resultado inventado.
 */
import type { AnalysisResult, Conversation } from "../contracts/index.js";
import type { RiskAnalyzer } from "./types.js";

export interface OciAnalyzerConfig {
  compartmentId: string;
  modelId: string;
  region: string;
}

const NOT_IMPLEMENTED =
  "ANALYZER=oci ainda não está implementado nesta demo. " +
  "Use ANALYZER=mock (padrão) para rodar sem credenciais. " +
  "Para plugar o motor real, implemente analyze() aqui usando o SDK da OCI " +
  "Generative AI e valide a resposta com analysisResultSchema de @diana/contracts.";

export class OciRiskAnalyzer implements RiskAnalyzer {
  readonly name = "oci-generative-ai";

  constructor(config: OciAnalyzerConfig) {
    const missing = (["compartmentId", "modelId", "region"] as const).filter(
      (key) => !config[key],
    );
    if (missing.length > 0) {
      throw new Error(
        `ANALYZER=oci exige as variáveis: ${missing
          .map((key) => `OCI_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`)
          .join(", ")}.`,
      );
    }
    // Fail-fast: não sobe um pipeline que quebraria na primeira conversa.
    throw new Error(NOT_IMPLEMENTED);
  }

  async analyze(_conversation: Conversation): Promise<AnalysisResult> {
    throw new Error(NOT_IMPLEMENTED);
  }
}

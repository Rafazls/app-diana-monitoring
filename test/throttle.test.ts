import { describe, expect, it } from "vitest";
import { MockRiskAnalyzer } from "../src/analyzer/mockAnalyzer.js";
import { OciRiskAnalyzer } from "../src/analyzer/ociAnalyzer.js";
import type { Conversation } from "../src/contracts/index.js";

const conversation: Conversation = {
  id: "c1",
  childId: "k",
  childName: "Lucas",
  contactId: "o",
  contactName: "Bruno",
  startedAt: "2026-09-14T10:00:00.000Z",
  messages: [
    { id: "M1", author: "other", text: "nosso segredo", timestamp: "2026-09-14T10:00:00.000Z" },
    { id: "M2", author: "other", text: "manda uma foto sua", timestamp: "2026-09-14T10:01:00.000Z" },
  ],
};

/** Cria um analisador cujo cliente responde o que o teste mandar. */
function analyzerComResposta(responder: () => Promise<unknown>, maxRetries = 2) {
  const a = new OciRiskAnalyzer({
    compartmentId: "ocid1.compartment.test",
    modelId: "modelo.teste",
    region: "sa-saopaulo-1",
    family: "cohere",
    maxRetries,
    fallback: new MockRiskAnalyzer(),
  });
  // Injeta um cliente falso, evitando autenticação e rede.
  (a as unknown as { getClient(): Promise<unknown> }).getClient = async () => ({
    chat: responder,
  });
  return a;
}

const erro429 = () => Object.assign(new Error("Service request limit is exceeded, request is throttled for tenant"), { statusCode: 429 });

describe("throttling da OCI (429)", () => {
  it("repete a chamada e usa a resposta quando o 429 passa", async () => {
    let chamadas = 0;
    const a = analyzerComResposta(async () => {
      chamadas += 1;
      if (chamadas < 3) throw erro429();
      return {
        chatResult: {
          chatResponse: {
            text: '{"signals":[{"type":"image_request","messageIds":["M2"],"confidence":0.9,"severity":"high"}]}',
          },
        },
      };
    });

    const r = await a.analyze(conversation);

    expect(chamadas).toBe(3);
    // Veio do modelo, não da heurística.
    expect(r.model.modelName).toContain("oci:");
    expect(r.signals.map((s) => s.type)).toContain("image_request");
    // A trilha registra que houve repetição.
    expect(r.audit.some((e) => e.description.includes("repetida"))).toBe(true);
  }, 20_000);

  it("cai para a heurística quando o 429 não passa, sem perder a conversa", async () => {
    let chamadas = 0;
    const a = analyzerComResposta(async () => {
      chamadas += 1;
      throw erro429();
    });

    const r = await a.analyze(conversation);

    // 1 tentativa original + 2 repetições
    expect(chamadas).toBe(3);
    expect(r.model.environment).toBe("mock");
    // A conversa continua analisada: os sinais estão lá.
    expect(r.signals.length).toBeGreaterThan(0);
    expect(r.audit.some((e) => e.description.includes("indisponível"))).toBe(true);
  }, 20_000);

  it("não repete erro que não é de limite", async () => {
    let chamadas = 0;
    const a = analyzerComResposta(async () => {
      chamadas += 1;
      throw Object.assign(new Error("NotAuthorizedOrNotFound"), { statusCode: 404 });
    });

    await a.analyze(conversation);

    // Repetir erro de permissão só atrasaria o inevitável.
    expect(chamadas).toBe(1);
  });
});

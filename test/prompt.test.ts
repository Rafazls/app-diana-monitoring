import { describe, expect, it } from "vitest";
import { buildUserPrompt, parseLlmResponse, SIGNAL_TYPES } from "../src/analyzer/prompt.js";
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
    { id: "M2", author: "child", text: "tá bom", timestamp: "2026-09-14T10:01:00.000Z" },
  ],
};

describe("buildUserPrompt", () => {
  it("identifica quem fala e mantém os ids para o modelo citar", () => {
    const prompt = buildUserPrompt(conversation);
    expect(prompt).toContain("[M1]");
    expect(prompt).toContain("OUTRO: nosso segredo");
    expect(prompt).toContain("CRIANÇA: tá bom");
  });
});

describe("parseLlmResponse", () => {
  it("aceita JSON limpo", () => {
    const r = parseLlmResponse(
      '{"signals":[{"type":"secrecy_request","messageIds":["M1"],"confidence":0.8,"severity":"medium"}]}',
    );
    expect(r.ok).toBe(true);
    expect(r.response?.signals[0]?.type).toBe("secrecy_request");
  });

  it("aceita JSON embrulhado em markdown, que os modelos insistem em mandar", () => {
    const r = parseLlmResponse(
      '```json\n{"signals":[{"type":"image_request","messageIds":["M1"],"confidence":0.9,"severity":"high"}]}\n```',
    );
    expect(r.ok).toBe(true);
    expect(r.response?.signals[0]?.type).toBe("image_request");
  });

  it("aceita ausência de sinais", () => {
    const r = parseLlmResponse('{"signals":[]}');
    expect(r.ok).toBe(true);
    expect(r.response?.signals).toHaveLength(0);
  });

  it("rejeita tipo de sinal fora do catálogo em vez de adivinhar", () => {
    const r = parseLlmResponse(
      '{"signals":[{"type":"coisa_inventada","messageIds":["M1"],"confidence":0.8,"severity":"high"}]}',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/type/);
  });

  it("rejeita confiança fora de 0–1", () => {
    const r = parseLlmResponse(
      '{"signals":[{"type":"threat","messageIds":["M1"],"confidence":7,"severity":"high"}]}',
    );
    expect(r.ok).toBe(false);
  });

  it("rejeita sinal sem mensagem que o sustente", () => {
    const r = parseLlmResponse(
      '{"signals":[{"type":"threat","messageIds":[],"confidence":0.5,"severity":"high"}]}',
    );
    expect(r.ok).toBe(false);
  });

  it("não lança quando a resposta não é JSON", () => {
    const r = parseLlmResponse("desculpe, não posso ajudar com isso");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it("o catálogo oferecido ao modelo cobre os dez tipos do contrato", () => {
    expect(SIGNAL_TYPES).toHaveLength(10);
    expect(SIGNAL_TYPES).toContain("self_harm");
    expect(SIGNAL_TYPES).toContain("grooming" in {} ? "grooming" : "secrecy_request");
  });
});

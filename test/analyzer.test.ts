import { describe, expect, it } from "vitest";
import type { Conversation } from "../src/contracts/index.js";
import { MockRiskAnalyzer } from "../src/analyzer/mockAnalyzer.js";

const analyzer = new MockRiskAnalyzer({ now: () => new Date("2026-09-14T12:00:00.000Z") });

function conversation(id: string, entries: Array<["child" | "other", string]>): Conversation {
  return {
    id,
    childId: "child-1",
    childName: "Ana",
    contactId: "contact-1",
    contactName: "Desconhecido_123",
    startedAt: "2026-09-14T10:00:00.000Z",
    messages: entries.map(([author, text], index) => ({
      id: `MSG-${index + 1}`,
      author,
      text,
      timestamp: new Date(Date.parse("2026-09-14T10:00:00.000Z") + index * 60_000).toISOString(),
    })),
  };
}

describe("MockRiskAnalyzer", () => {
  it("não alerta sobre conversa inofensiva", async () => {
    const result = await analyzer.analyze(
      conversation("ok", [
        ["other", "oi! tudo bem?"],
        ["child", "tudo! acabei a lição"],
      ]),
    );
    expect(result.assessment.score).toBe(0);
    expect(result.assessment.requiresGuardianAttention).toBe(false);
  });

  it("identifica grooming como crítico", async () => {
    const result = await analyzer.analyze(
      conversation("grooming", [
        ["other", "fica só entre a gente, nosso segredo"],
        ["other", "seus amigos não te entendem, fala só comigo"],
        ["other", "onde você mora? está sozinho?"],
        ["other", "manda uma foto sua"],
      ]),
    );
    expect(result.assessment.level).toBe("critical");
    expect(result.assessment.categories.map((c) => c.category)).toContain("grooming");
  });

  it("eleva o alerta com sinal de automutilação, mesmo com pontuação menor", async () => {
    const result = await analyzer.analyze(
      conversation("self-harm", [["child", "às vezes eu queria desaparecer pra sempre"]]),
    );
    expect(result.assessment.requiresGuardianAttention).toBe(true);
  });

  it("emite tipos de sinal no vocabulário que a tela usa para escolher o ícone", async () => {
    const result = await analyzer.analyze(
      conversation("sinais", [
        ["other", "nosso segredo"],
        ["other", "manda uma foto sua"],
      ]),
    );
    const types = result.signals.map((s) => s.type);
    expect(types).toContain("secrecy_request");
    expect(types).toContain("image_request");
    // A chave interna da característica não pode vazar para a tela.
    expect(types).not.toContain("secrecyRequests");
  });

  it("RF-16: o resultado não carrega texto de mensagem nem identidade", async () => {
    const conv = conversation("privacidade", [
      ["other", "nosso segredo, manda uma foto sua"],
      ["child", "tenho medo"],
    ]);
    const serialized = JSON.stringify(await analyzer.analyze(conv));

    for (const message of conv.messages) expect(serialized).not.toContain(message.text);
    expect(serialized).not.toContain(conv.contactName);
    expect(serialized).not.toContain(conv.childName);
  });

  it("é determinístico", async () => {
    const conv = conversation("estavel", [["other", "nosso segredo, não conta pra ninguém"]]);
    const first = JSON.stringify(await analyzer.analyze(conv));
    expect(JSON.stringify(await analyzer.analyze(conv))).toBe(first);
  });
});

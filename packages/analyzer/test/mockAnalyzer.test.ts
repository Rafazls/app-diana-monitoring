import { describe, expect, it } from "vitest";
import type { Conversation } from "@diana/contracts";
import { MockRiskAnalyzer } from "../src/mockAnalyzer.js";

const analyzer = new MockRiskAnalyzer({ now: () => new Date("2026-09-14T12:00:00.000Z") });

function conversation(
  id: string,
  entries: Array<["child" | "other", string]>,
): Conversation {
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
  it("não alerta sobre uma conversa inofensiva", async () => {
    const result = await analyzer.analyze(
      conversation("conv-ok", [
        ["other", "oi! tudo bem com você?"],
        ["child", "tudo! acabei a lição de casa"],
        ["other", "que ótimo, parabéns"],
      ]),
    );

    expect(result.assessment.score).toBe(0);
    expect(result.assessment.level).toBe("none");
    expect(result.assessment.requiresGuardianAttention).toBe(false);
    expect(result.signals).toHaveLength(0);
  });

  it("identifica o padrão de grooming e classifica como crítico", async () => {
    const result = await analyzer.analyze(
      conversation("conv-grooming", [
        ["other", "fica só entre a gente, nosso segredo"],
        ["child", "tá bom"],
        ["other", "seus amigos não te entendem, fala só comigo"],
        ["other", "onde você mora? está sozinho?"],
        ["other", "manda uma foto sua"],
      ]),
    );

    expect(result.assessment.level).toBe("critical");
    expect(result.assessment.requiresGuardianAttention).toBe(true);
    const categories = result.assessment.categories.map((c) => c.category);
    expect(categories).toContain("grooming");
    expect(categories).toContain("image_request");
    expect(categories).toContain("isolation");
  });

  it("eleva o alerta quando há sinal de automutilação, mesmo com pontuação menor", async () => {
    const result = await analyzer.analyze(
      conversation("conv-self-harm", [
        ["child", "às vezes eu queria desaparecer pra sempre"],
        ["other", "fala comigo, o que aconteceu?"],
      ]),
    );

    expect(result.assessment.requiresGuardianAttention).toBe(true);
    expect(result.assessment.categories.map((c) => c.category)).toContain("self_harm");
  });

  it("só conta pedido de segredo vindo do interlocutor, não da criança", async () => {
    const result = await analyzer.analyze(
      conversation("conv-child-secret", [["child", "não conta pra minha mãe que eu comi doce"]]),
    );

    expect(result.features.secrecyRequests).toBe(0);
  });

  it("RF-16: o resultado não carrega nenhum texto das mensagens", async () => {
    const conv = conversation("conv-privacidade", [
      ["other", "nosso segredo, manda uma foto sua"],
      ["child", "tenho medo"],
    ]);
    const result = await analyzer.analyze(conv);

    const serialized = JSON.stringify(result);
    for (const message of conv.messages) {
      expect(serialized).not.toContain(message.text);
    }
    // Nem a identidade do contato: o payload de análise é identity-free.
    expect(serialized).not.toContain(conv.contactName);
    expect(serialized).not.toContain(conv.childName);
    // Mas mantém as referências opacas que permitem auditoria.
    expect(result.signals[0]?.messageIds.length).toBeGreaterThan(0);
  });

  it("é determinístico: a mesma conversa gera o mesmo veredito", async () => {
    const conv = conversation("conv-estavel", [["other", "nosso segredo, não conta pra ninguém"]]);
    const first = await analyzer.analyze(conv);
    const second = await analyzer.analyze(conv);

    expect(second.assessment.score).toBe(first.assessment.score);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

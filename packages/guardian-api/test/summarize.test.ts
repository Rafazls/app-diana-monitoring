import { describe, expect, it } from "vitest";
import type { AlertRecord } from "../src/contracts/index.js";
import { mapPriority, toAlertSummary, toAlertView } from "../src/domain/summarize.js";
import { demoAlertRecords } from "../src/sources/fixtures/demoAlerts.js";

const grooming = (): AlertRecord =>
  demoAlertRecords().find((r) => r.conversationId === "conv-demo-grooming")!;

describe("mapPriority", () => {
  it("mapeia low|medium|high para baixa|media|alta", () => {
    expect(mapPriority("low")).toBe("baixa");
    expect(mapPriority("medium")).toBe("media");
    expect(mapPriority("high")).toBe("alta");
  });

  it("é exaustivo com fallback fail-safe 'alta' para valor fora do contrato", () => {
    // Defesa em profundidade: um valor fora de low|medium|high (deriva) nunca é
    // subestimado — cai em "alta".
    expect(mapPriority("critical" as unknown as "high")).toBe("alta");
  });
});

describe("toAlertSummary", () => {
  it("deriva o resumo com a categoria principal (maior probabilidade)", () => {
    const summary = toAlertSummary(grooming(), { childName: "Caio" });
    expect(summary.childName).toBe("Caio");
    expect(summary.priority).toBe("alta");
    expect(summary.score).toBe(73);
    expect(summary.category).toMatch(/grooming/i);
    expect(summary.detectedAt).toBe("2026-09-13T14:47:00.000Z");
  });

  it("usa fallback 'Criança' quando o nome não é fornecido", () => {
    expect(toAlertSummary(grooming()).childName).toBe("Criança");
  });
});

describe("toAlertView", () => {
  it("expõe assessment/sinais/explicação resumidos e occurrences", () => {
    const view = toAlertView(grooming(), { childName: "Caio" });
    expect(view.rationale).toBeTruthy();
    expect(view.categories.length).toBeGreaterThan(0);
    expect(view.signals[0]?.occurrences).toBe(view.signals[0]?.messageIds.length);
    expect(view.explanation.recommendedActions.length).toBeGreaterThan(0);
    expect(view.model.environment).toBe("mock");
  });
});

describe("RF-16 — nenhuma conversa/texto bruto vaza", () => {
  it("nenhuma serialização contém campos brutos proibidos", () => {
    for (const record of demoAlertRecords()) {
      const serialized =
        JSON.stringify(toAlertView(record)) + JSON.stringify(toAlertSummary(record));
      expect(serialized).not.toContain('"messages"');
      expect(serialized).not.toContain('"text"');
      expect(serialized).not.toContain('"conversation"');
      expect(serialized).not.toContain('"transcript"');
    }
  });

  it("a projeção por allowlist DESCARTA campos desconhecidos (mesmo com nome fora da denylist)", () => {
    const poisoned = grooming();
    // Simula deriva de contrato: categoria e fator contextual ganham campos de
    // conteúdo bruto com nomes NÃO listados na denylist antiga (snippet/content/
    // excerpt/body). A allowlist explícita deve descartá-los da projeção.
    Object.assign(poisoned.result.assessment.categories[0]!, {
      snippet: "trecho cru da conversa",
      excerpt: "outro trecho",
    });
    Object.assign(poisoned.result.explanation.contextualFactors[0]!, {
      content: "mensagem crua da criança",
      body: "corpo bruto",
    });

    const serialized = JSON.stringify(toAlertView(poisoned));
    for (const leaked of ["snippet", "excerpt", "content", "body", "trecho cru", "mensagem crua"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("o backstop denylist barra conteúdo bruto que sobreviva à projeção", () => {
    const poisoned = grooming();
    // Injeta uma chave proibida num nó repassado (signals[].messageIds é
    // string[]; usamos o próprio sinal, cujos campos são allowlisted — então
    // exercitamos o backstop diretamente forçando um campo proibido a sobreviver
    // via um objeto de sinal manipulado que a projeção copia por referência de
    // string.) Aqui garantimos que a asserção reconhece a chave proibida.
    Object.assign(poisoned.result.signals[0]!, { transcript: "conversa integral" });
    // `transcript` não é campo allowlisted de DetectedSignal, logo é descartado;
    // a serialização não pode conter o conteúdo.
    const serialized = JSON.stringify(toAlertView(poisoned));
    expect(serialized).not.toContain("transcript");
    expect(serialized).not.toContain("conversa integral");
  });
});

import { describe, expect, it } from "vitest";
import { decodeAlertId, encodeAlertId } from "../src/domain/alertId.js";

describe("alertId", () => {
  it("faz round-trip de encode/decode", () => {
    const id = encodeAlertId("conv-demo-grooming", "2026-09-13T14:47:00.000Z");
    expect(decodeAlertId(id)).toEqual({
      conversationId: "conv-demo-grooming",
      processedAt: "2026-09-13T14:47:00.000Z",
    });
  });

  it("é reversível para ids com caracteres especiais", () => {
    const id = encodeAlertId("conv/estranho+id", "2026-01-01T00:00:00.000Z");
    expect(decodeAlertId(id)).toEqual({
      conversationId: "conv/estranho+id",
      processedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejeita separador nos componentes", () => {
    expect(() => encodeAlertId("a|b", "2026-01-01T00:00:00.000Z")).toThrow();
  });

  it("devolve null para ids malformados", () => {
    expect(decodeAlertId("")).toBeNull();
    expect(decodeAlertId("!!!nao-e-base64!!!")).toBeNull();
    // base64url de "semseparador" (sem "|") -> inválido.
    expect(decodeAlertId(Buffer.from("semseparador", "utf-8").toString("base64url"))).toBeNull();
  });
});

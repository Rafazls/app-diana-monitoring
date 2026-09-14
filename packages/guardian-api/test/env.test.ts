import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("aplica defaults seguros para a demo", () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.host).toBe("0.0.0.0");
    expect(config.alertsSource).toBe("fixtures");
    expect(config.writeBackend).toBe("memory"); // segue fixtures
    expect(config.apiKey).toBe("");
    expect(config.corsOrigins).toEqual(["*"]);
  });

  it("deriva writeBackend de ALERTS_SOURCE quando não definido", () => {
    expect(loadConfig({ ALERTS_SOURCE: "file" }).writeBackend).toBe("file");
    expect(loadConfig({ ALERTS_SOURCE: "oci" }).writeBackend).toBe("oci");
  });

  it("respeita WRITE_BACKEND explícito", () => {
    const config = loadConfig({ ALERTS_SOURCE: "file", WRITE_BACKEND: "memory" });
    expect(config.writeBackend).toBe("memory");
  });

  it("faz parse de CORS_ORIGINS como CSV", () => {
    const config = loadConfig({ CORS_ORIGINS: "https://a.com, https://b.com" });
    expect(config.corsOrigins).toEqual(["https://a.com", "https://b.com"]);
  });

  it("rejeita ALERTS_SOURCE inválido", () => {
    expect(() => loadConfig({ ALERTS_SOURCE: "banco" })).toThrow(
      /Configuração de ambiente inválida/,
    );
  });

  it("rejeita PORT fora de faixa", () => {
    expect(() => loadConfig({ PORT: "70000" })).toThrow();
  });
});

/**
 * `@diana/contracts` — a "linguagem comum" do ecossistema DIANA.
 *
 * Um único lugar define as formas que atravessam todos os pacotes:
 *   `Conversation` (entrada, só o núcleo vê)
 *   -> `AnalysisResult` (veredito agregado do analisador)
 *   -> `AlertRecord` (o que é persistido e servido ao responsável)
 *
 * 🧊 RF-16: o `AlertRecord` NUNCA carrega a conversa integral — apenas o
 * `AnalysisResult`. Quem serve dados à UI projeta por allowlist a partir daqui
 * (ver `@diana/guardian-api` -> `domain/summarize.ts`).
 */
export * from "./types.js";
export * from "./alertRecord.js";
export * from "./schema.js";
export * from "./viewTypes.js";

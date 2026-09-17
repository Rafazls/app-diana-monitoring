/**
 * Contrato de domínio da DIANA.
 *
 * A "linguagem comum" do sistema: `Conversation` (o que entra, e que só o
 * backend vê) -> `AnalysisResult` (o veredito agregado) -> `AlertRecord` (o que
 * é persistido).
 *
 * 🧊 RF-16: o `AlertRecord` nunca carrega a conversa integral — apenas o
 * `AnalysisResult`, que por sua vez é identity-free.
 */
export * from "./types.js";
export * from "./alertRecord.js";
export * from "./schema.js";

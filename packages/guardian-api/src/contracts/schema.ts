/**
 * Ponte para o schema zod do contrato compartilhado (ver `./index.ts`).
 *
 * Mantida como arquivo próprio porque as fontes importam
 * `../contracts/schema.js` diretamente para validar o que leem do disco/OCI.
 */
export { alertRecordSchema, analysisResultSchema, parseAlertRecord } from "@diana/contracts";

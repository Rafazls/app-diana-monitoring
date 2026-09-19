import oracledb from "oracledb";
import { alertRecordSchema, type AlertRecord, type AnalysisResult } from "../contracts/index.js";
import { logger } from "../logger.js";
import { BaseAlertStore } from "./BaseAlertStore.js";
import type { AlertStore } from "./AlertStore.js";

export interface OracleAlertConfig {
  user: string;
  password: string;
  connectString: string;
  walletDir?: string;
  walletPassword?: string;
  poolMin?: number;
  poolMax?: number;
}

/** Chave estável de um alerta. O par (conversa, instante) já é único. */
function alertId(conversationId: string, processedAt: string): string {
  return `${conversationId}|${processedAt}`;
}

export class OracleAlertStore extends BaseAlertStore implements AlertStore {
  readonly name = "oracle";
  private pool: oracledb.Pool | null = null;

  constructor(private readonly config: OracleAlertConfig) {
    super();
    const faltando = (["user", "password", "connectString"] as const).filter((k) => !config[k]);
    if (faltando.length > 0) {
      throw new Error(
        `STORE=oracle exige: ${faltando.map((k) => `ORACLE_${k.toUpperCase()}`).join(", ")}.`,
      );
    }
  }

  async init(): Promise<void> {
    if (this.pool) return;

    this.pool = await oracledb.createPool({
      user: this.config.user,
      password: this.config.password,
      connectString: this.config.connectString,
      poolMin: this.config.poolMin ?? 1,
      poolMax: this.config.poolMax ?? 2,
      ...(this.config.walletDir
        ? {
            configDir: this.config.walletDir,
            walletLocation: this.config.walletDir,
            ...(this.config.walletPassword ? { walletPassword: this.config.walletPassword } : {}),
          }
        : {}),
    });

    // `childName` é síncrono no contrato do AlertStore, então não dá para
    // consultar o banco na hora: o índice de nomes é carregado uma vez aqui.
    await this.hydrateNames();
  }

  private requirePool(): oracledb.Pool {
    if (!this.pool) throw new Error("OracleAlertStore.init() não foi chamado.");
    return this.pool;
  }

  private async hydrateNames(): Promise<void> {
    const conn = await this.requirePool().getConnection();
    try {
      const r = await conn.execute<{ CONVERSATION_ID: string; CHILD_NAME: string | null }>(
        `SELECT conversation_id, MAX(child_name) AS child_name
           FROM diana_alerts
          GROUP BY conversation_id`,
        {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      for (const row of r.rows ?? []) {
        if (row.CHILD_NAME) this.names.set(row.CONVERSATION_ID, row.CHILD_NAME);
      }
    } catch (err) {
      // A tabela pode ainda não existir se o OracleBatchStore não subiu antes.
      // Não é fatal: os nomes reaparecem conforme os alertas forem gravados.
      logger.warn("Oracle: não foi possível carregar o índice de nomes.", err);
    } finally {
      await conn.close();
    }
  }

  async save(result: AnalysisResult, childName: string): Promise<AlertRecord> {
    const record: AlertRecord = {
      conversationId: result.conversationId,
      processedAt: result.processedAt,
      result,
    };

    const conn = await this.requirePool().getConnection();
    try {
      // Reanálise substitui, igual ao FileAlertStore: a conversa tem um alerta
      // corrente, não um histórico de versões que a tela não sabe exibir.
      await conn.execute(`DELETE FROM diana_alerts WHERE conversation_id = :conversationId`, {
        conversationId: record.conversationId,
      });
      await conn.execute(
        `INSERT INTO diana_alerts
           (alert_id, conversation_id, child_name, processed_at, result)
         VALUES (:alertId, :conversationId, :childName,
                 TO_TIMESTAMP(:processedAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), :result)`,
        {
          alertId: alertId(record.conversationId, record.processedAt),
          conversationId: record.conversationId,
          childName,
          processedAt: record.processedAt,
          result: JSON.stringify(record),
        },
      );
      await conn.commit();
    } finally {
      await conn.close();
    }

    this.names.set(record.conversationId, childName);
    return record;
  }

  async list(): Promise<AlertRecord[]> {
    const conn = await this.requirePool().getConnection();
    try {
      const r = await conn.execute<{ ALERT_ID: string; RESULT: string }>(
        `SELECT alert_id, result FROM diana_alerts ORDER BY processed_at DESC`,
        {},
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { RESULT: { type: oracledb.STRING } },
        },
      );
      return (r.rows ?? [])
        .map((row) => this.parseValidated(row.RESULT, row.ALERT_ID))
        .filter((x): x is AlertRecord => x !== null);
    } finally {
      await conn.close();
    }
  }

  async get(conversationId: string, processedAt: string): Promise<AlertRecord | null> {
    const conn = await this.requirePool().getConnection();
    try {
      const r = await conn.execute<{ RESULT: string }>(
        `SELECT result FROM diana_alerts WHERE alert_id = :alertId`,
        { alertId: alertId(conversationId, processedAt) },
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchInfo: { RESULT: { type: oracledb.STRING } },
        },
      );
      const row = r.rows?.[0];
      return row ? this.parseValidated(row.RESULT, alertId(conversationId, processedAt)) : null;
    } finally {
      await conn.close();
    }
  }

  /**
   * Valida contra o contrato antes de entregar. Registro malformado é logado e
   * IGNORADO — nunca propagado à borda, onde viraria uma tela quebrada para o
   * responsável. Mesma postura do FileAlertStore.
   */
  private parseValidated(raw: string, id: string): AlertRecord | null {
    try {
      const parsed = alertRecordSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
      logger.warn(`Oracle: alerta ${id} não bate com o contrato; ignorado.`);
      return null;
    } catch {
      logger.warn(`Oracle: alerta ${id} tem JSON inválido; ignorado.`);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.pool?.close(5);
    this.pool = null;
  }
}

import oracledb from "oracledb";
import { logger } from "../logger.js";
import type { Batch, BatchStore } from "./types.js";

export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
  /** Pasta do wallet (ADB com mTLS). */
  walletDir?: string;
  walletPassword?: string;
  poolMin?: number;
  poolMax?: number;
}

const DDL_BATCHES = `
DECLARE v_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_existe FROM user_tables WHERE table_name = 'DIANA_BATCHES';
  IF v_existe = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE diana_batches (
        batch_id        VARCHAR2(80)  PRIMARY KEY,
        conversation_id VARCHAR2(200) NOT NULL,
        child_name      VARCHAR2(200),
        contact_name    VARCHAR2(200),
        created_at      TIMESTAMP     NOT NULL,
        messages        CLOB          CHECK (messages IS JSON)
      )';
    EXECUTE IMMEDIATE '
      CREATE INDEX ix_diana_batches_conv
        ON diana_batches (conversation_id, created_at)';
  END IF;
END;`;

const DDL_ALERTS = `
DECLARE v_existe NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_existe FROM user_tables WHERE table_name = 'DIANA_ALERTS';
  IF v_existe = 0 THEN
    EXECUTE IMMEDIATE '
      CREATE TABLE diana_alerts (
        alert_id        VARCHAR2(300) PRIMARY KEY,
        conversation_id VARCHAR2(200) NOT NULL,
        child_name      VARCHAR2(200),
        processed_at    TIMESTAMP     NOT NULL,
        result          CLOB          CHECK (result IS JSON)
      )';
    EXECUTE IMMEDIATE '
      CREATE INDEX ix_diana_alerts_conv
        ON diana_alerts (conversation_id, processed_at)';
  END IF;
END;`;

export class OracleBatchStore implements BatchStore {
  readonly name = "oracle";
  private pool: oracledb.Pool | null = null;

  constructor(private readonly config: OracleConfig) {
    const faltando = (["user", "password", "connectString"] as const).filter((k) => !config[k]);
    if (faltando.length > 0) {
      throw new Error(
        `STORE=oracle exige: ${faltando.map((k) => "ORACLE_" + k.toUpperCase()).join(", ")}.`,
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
      poolMax: this.config.poolMax ?? 4,
      ...(this.config.walletDir
        ? {
            configDir: this.config.walletDir,
            walletLocation: this.config.walletDir,
            ...(this.config.walletPassword ? { walletPassword: this.config.walletPassword } : {}),
          }
        : {}),
    });

    const conn = await this.pool.getConnection();
    try {
      await conn.execute(DDL_BATCHES);
      await conn.execute(DDL_ALERTS);
      await conn.commit();
      logger.info("Oracle: conectado e tabelas verificadas (diana_batches, diana_alerts).");
    } finally {
      await conn.close();
    }
  }

  private requirePool(): oracledb.Pool {
    if (!this.pool) throw new Error("OracleBatchStore.init() não foi chamado.");
    return this.pool;
  }

  async save(batch: Batch): Promise<void> {
    const conn = await this.requirePool().getConnection();
    try {
      await conn.execute(
        `INSERT INTO diana_batches
           (batch_id, conversation_id, child_name, contact_name, created_at, messages)
         VALUES (:batchId, :conversationId, :childName, :contactName,
                 TO_TIMESTAMP(:createdAt, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"'), :messages)`,
        {
          batchId: batch.batchId,
          conversationId: batch.conversationId,
          childName: batch.childName,
          contactName: batch.contactName,
          createdAt: batch.createdAt,
          messages: JSON.stringify(batch.messages),
        },
        { autoCommit: true },
      );
    } finally {
      await conn.close();
    }
  }

  async recent(conversationId: string, limit: number): Promise<Batch[]> {
    const conn = await this.requirePool().getConnection();
    try {
      const result = await conn.execute<{
        BATCH_ID: string;
        CONVERSATION_ID: string;
        CHILD_NAME: string | null;
        CONTACT_NAME: string | null;
        CREATED_AT: Date;
        MESSAGES: string;
      }>(
        `SELECT batch_id, conversation_id, child_name, contact_name, created_at, messages
           FROM diana_batches
          WHERE conversation_id = :conversationId
          ORDER BY created_at DESC
          FETCH FIRST :limite ROWS ONLY`,
        { conversationId, limite: limit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { MESSAGES: { type: oracledb.STRING } } },
      );

      const linhas = result.rows ?? [];
      // A consulta traz do mais novo ao mais antigo; a análise quer cronológico.
      return linhas
        .map((r) => ({
          batchId: r.BATCH_ID,
          conversationId: r.CONVERSATION_ID,
          childName: r.CHILD_NAME ?? "Criança",
          contactName: r.CONTACT_NAME ?? "Contato",
          createdAt: r.CREATED_AT.toISOString(),
          messages: JSON.parse(r.MESSAGES) as Batch["messages"],
        }))
        .reverse();
    } finally {
      await conn.close();
    }
  }

  async close(): Promise<void> {
    await this.pool?.close(5);
    this.pool = null;
  }
}

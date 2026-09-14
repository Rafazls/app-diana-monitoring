/**
 * DIANA guardian-api — leitor de alertas por FIXTURES (default / demo).
 *
 * Serve os `AlertRecord` embutidos em `fixtures/demoAlerts.ts`. Read-only,
 * determinístico e sem credenciais — o modo padrão da demonstração.
 */
import type { AlertRecord } from "../contracts/index.js";
import type { AlertReader } from "./AlertReader.js";
import { demoAlertRecords, demoChildNames } from "./fixtures/demoAlerts.js";

export class FixtureAlertReader implements AlertReader {
  private readonly records: AlertRecord[];

  constructor(records: AlertRecord[] = demoAlertRecords()) {
    this.records = records;
  }

  async listAlerts(): Promise<AlertRecord[]> {
    return this.records.map((r) => structuredClone(r));
  }

  async getAlert(conversationId: string, processedAt: string): Promise<AlertRecord | null> {
    const found = this.records.find(
      (r) => r.conversationId === conversationId && r.processedAt === processedAt,
    );
    return found ? structuredClone(found) : null;
  }

  resolveChildName(conversationId: string): string | undefined {
    return demoChildNames[conversationId];
  }
}

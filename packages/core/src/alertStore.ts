/**
 * Persistência de alertas em disco.
 *
 * O layout é o MESMO que o núcleo usa no OCI Object Storage e que o
 * `guardian-api` já sabe ler (`FileAlertReader`):
 *
 *   <stateDir>/alerts/<conversationId>/<processedAt>.json
 *
 * Manter o layout idêntico é o que faz a demo exercitar o código real: a API
 * não tem um "modo demo" — ela só aponta para outro diretório.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AlertRecord, AnalysisResult } from "@diana/contracts";

/**
 * Sanitiza um id para virar nome de arquivo/pasta. Precisa casar exatamente
 * com o `safeId` do `guardian-api`, senão `getAlert` não encontra o registro.
 */
export function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileAlertStore {
  private readonly alertsDir: string;
  private readonly childrenFile: string;

  constructor(private readonly stateDir: string) {
    this.alertsDir = path.join(stateDir, "alerts");
    this.childrenFile = path.join(stateDir, "children.json");
  }

  /**
   * Índice `conversationId -> childName`, gravado SEPARADO dos alertas.
   *
   * O nome da criança de propósito não entra no `AnalysisResult`: o payload de
   * risco deve ser útil sem identificar ninguém. Quem tem direito de ver o nome
   * (o responsável) resolve por este índice — que um dia será uma consulta ao
   * cadastro da família, não um arquivo.
   */
  async saveChildIndex(entries: Record<string, string>): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeFile(this.childrenFile, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
  }

  /** Grava o `AlertRecord` derivado de um `AnalysisResult`. */
  async save(result: AnalysisResult): Promise<string> {
    const record: AlertRecord = {
      conversationId: result.conversationId,
      processedAt: result.processedAt,
      result,
    };

    const dir = path.join(this.alertsDir, safeId(record.conversationId));
    await fs.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${safeId(record.processedAt)}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    return filePath;
  }

  /** Limpa alertas de execuções anteriores (a demo deve ser reproduzível). */
  async reset(): Promise<void> {
    await fs.rm(this.alertsDir, { recursive: true, force: true });
    await fs.rm(this.childrenFile, { force: true });
  }
}

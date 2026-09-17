/**
 * Estado que todo AlertStore compartilha: índice de nomes e marcação de
 * leitura, ambos em memória.
 *
 * Mora num módulo separado de propósito. O `OracleAlertStore` herda daqui e
 * o `createAlertStore` (em AlertStore.ts) o constrói — se a base vivesse lá,
 * o ciclo de importação estouraria em tempo de execução com "Cannot access
 * 'BaseAlertStore' before initialization", que o TypeScript não acusa.
 */
export abstract class BaseAlertStore {
  protected readonly names = new Map<string, string>();
  private readonly readKeys = new Set<string>();

  protected key(conversationId: string, processedAt: string): string {
    return `${conversationId}|${processedAt}`;
  }

  childName(conversationId: string): string | undefined {
    return this.names.get(conversationId);
  }

  markRead(conversationId: string, processedAt: string): void {
    this.readKeys.add(this.key(conversationId, processedAt));
  }

  isRead(conversationId: string, processedAt: string): boolean {
    return this.readKeys.has(this.key(conversationId, processedAt));
  }
}

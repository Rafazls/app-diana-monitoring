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

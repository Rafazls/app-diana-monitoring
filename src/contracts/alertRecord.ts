import type { AnalysisResult } from "./types.js";

export interface AlertRecord {
  conversationId: string;
  /** ISO 8601. */
  processedAt: string;
  result: AnalysisResult;
}

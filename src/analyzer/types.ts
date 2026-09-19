import type { AnalysisResult, Conversation } from "../contracts/index.js";

export interface RiskAnalyzer {
  readonly name: string;
  analyze(conversation: Conversation): Promise<AnalysisResult>;
}

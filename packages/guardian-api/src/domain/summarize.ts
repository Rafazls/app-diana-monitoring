/**
 * DIANA guardian-api — projeções de resumo (RF-16 / §6 da análise).
 *
 * Transforma o `AlertRecord` gravado pelo núcleo em:
 *   - `AlertSummary` (item de lista, `GET /alerts`);
 *   - `AlertView` (detalhe, `GET /alerts/{id}`).
 *
 * 🧊 A garantia central: NUNCA serializar conteúdo bruto de mensagem/
 * `Conversation`. O `AnalysisResult` já é privacy-safe; ainda assim aplicamos
 * uma ASSERÇÃO DEFENSIVA (`assertNoRawContent`) — se um campo bruto aparecer no
 * futuro (deriva de contrato), a serialização falha em vez de vazar.
 */
import type {
  AlertRecord,
  AnalysisResult,
  ContextualFactor,
  DetectedSignal,
  RiskPrediction,
  RiskPriority,
} from "../contracts/index.js";
import { riskCategoryLabels } from "../contracts/index.js";
import { logger } from "../logger.js";
import { encodeAlertId } from "./alertId.js";
import type { AlertSummary, AlertView, AlertViewSignal, GuardianPriority } from "./viewTypes.js";

const FALLBACK_CHILD_NAME = "Criança";

/**
 * Backstop de RF-16 (defesa em profundidade). A garantia PRIMÁRIA é a projeção
 * por ALLOWLIST (cada campo do payload é escolhido explicitamente — ver
 * `toViewSignal`/`toViewCategory`/`toViewFactor`), então nenhuma chave
 * desconhecida do contrato chega à resposta. Esta denylist é apenas uma rede de
 * segurança adicional, com nomes comuns de conteúdo bruto.
 */
const FORBIDDEN_RAW_KEYS = new Set([
  "messages",
  "text",
  "conversation",
  "rawText",
  "transcript",
  "snippet",
  "content",
  "excerpt",
  "body",
  "messageText",
]);

export interface SummarizeOptions {
  /** Nome da criança (o `AnalysisResult` não carrega — §6.4). */
  childName?: string;
}

/**
 * `RiskPriority` (low|medium|high) -> rótulo da UI (baixa|media|alta).
 * Exaustivo com fallback explícito: um valor fora do contrato (deriva/dado
 * malformado que passe a validação) cai em "alta" — **fail-safe**, nunca
 * subestima um risco desconhecido — e é logado.
 */
export function mapPriority(priority: RiskPriority): GuardianPriority {
  switch (priority) {
    case "high":
      return "alta";
    case "medium":
      return "media";
    case "low":
      return "baixa";
    default:
      logger.warn(
        `mapPriority: prioridade fora do contrato "${String(priority)}" — usando "alta".`,
      );
      return "alta";
  }
}

/** Projeção por allowlist: apenas os campos conhecidos de `RiskPrediction`. */
function toViewCategory(c: RiskPrediction): RiskPrediction {
  return { category: c.category, probability: c.probability, level: c.level };
}

/** Projeção por allowlist: apenas os campos conhecidos de `ContextualFactor`. */
function toViewFactor(f: ContextualFactor): ContextualFactor {
  return { type: f.type, label: f.label, description: f.description, contribution: f.contribution };
}

/** Categoria principal = maior probabilidade; usada em título/rótulo. */
function principalCategory(categories: RiskPrediction[]): RiskPrediction | null {
  if (categories.length === 0) return null;
  return categories.reduce((best, current) =>
    current.probability > best.probability ? current : best,
  );
}

/**
 * Asserção defensiva de RF-16: varre (raso, nos pontos onde conteúdo bruto
 * poderia entrar) procurando chaves proibidas. Lança se encontrar.
 */
function assertNoRawContent(value: unknown, path = "root"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoRawContent(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    // `messageIds` é permitido (referências opacas, sem conteúdo).
    if (FORBIDDEN_RAW_KEYS.has(key)) {
      throw new Error(
        `RF-16: campo bruto proibido "${key}" detectado em ${path} — serialização abortada.`,
      );
    }
    assertNoRawContent(child, `${path}.${key}`);
  }
}

function toViewSignal(signal: DetectedSignal): AlertViewSignal {
  return {
    id: signal.id,
    type: signal.type,
    title: signal.title,
    description: signal.description,
    severity: signal.severity,
    confidence: signal.confidence,
    // Referências opacas — a UI usa apenas `.length`/`occurrences`.
    messageIds: [...signal.messageIds],
    occurrences: signal.messageIds.length,
  };
}

/** Deriva o `AlertSummary` (item de lista) de um `AlertRecord`. */
export function toAlertSummary(record: AlertRecord, opts: SummarizeOptions = {}): AlertSummary {
  const result: AnalysisResult = record.result;
  const principal = principalCategory(result.assessment.categories);
  const category = principal ? riskCategoryLabels[principal.category] : "Risco não classificado";

  const summary: AlertSummary = {
    id: encodeAlertId(record.conversationId, record.processedAt),
    conversationId: record.conversationId,
    childName: opts.childName ?? FALLBACK_CHILD_NAME,
    title: category,
    category,
    priority: mapPriority(result.assessment.priority),
    level: result.assessment.level,
    score: result.assessment.score,
    requiresGuardianAttention: result.assessment.requiresGuardianAttention,
    detectedAt: record.processedAt,
  };
  assertNoRawContent(summary, "AlertSummary");
  return summary;
}

/** Deriva o `AlertView` (detalhe resumido) de um `AlertRecord`. */
export function toAlertView(record: AlertRecord, opts: SummarizeOptions = {}): AlertView {
  const result: AnalysisResult = record.result;

  const view: AlertView = {
    id: encodeAlertId(record.conversationId, record.processedAt),
    conversationId: record.conversationId,
    childName: opts.childName ?? FALLBACK_CHILD_NAME,
    detectedAt: record.processedAt,
    priority: mapPriority(result.assessment.priority),
    level: result.assessment.level,
    score: result.assessment.score,
    requiresGuardianAttention: result.assessment.requiresGuardianAttention,
    rationale: result.assessment.rationale,
    categories: result.assessment.categories.map(toViewCategory),
    signals: result.signals.map(toViewSignal),
    explanation: {
      summary: result.explanation.summary,
      topSignals: result.explanation.topSignals.map(toViewSignal),
      contextualFactors: result.explanation.contextualFactors.map(toViewFactor),
      recommendedActions: [...result.explanation.recommendedActions],
    },
    model: {
      modelName: result.model.modelName,
      version: result.model.version,
      environment: result.model.environment,
    },
  };
  assertNoRawContent(view, "AlertView");
  return view;
}

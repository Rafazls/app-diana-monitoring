import type { Conversation, ConversationFeatures, MessageAuthor } from "../contracts/index.js";

interface Pattern {
  key: keyof ConversationFeatures;
  label: string;
  expressions: string[];
  onlyFrom?: MessageAuthor;
}

const PATTERNS: Pattern[] = [
  {
    key: "secrecyRequests",
    label: "Pedido de segredo",
    onlyFrom: "other",
    expressions: [
      "nao conta",
      "não conta",
      "nosso segredo",
      "segredo nosso",
      "ninguem precisa saber",
      "ninguém precisa saber",
      "apaga essa conversa",
      "apague a conversa",
      "nao fala pra ninguem",
      "não fala pra ninguém",
    ],
  },
  {
    key: "imageRequests",
    label: "Pedido de imagem",
    onlyFrom: "other",
    expressions: [
      "manda uma foto",
      "me manda foto",
      "manda foto sua",
      "tira uma foto",
      "liga a camera",
      "liga a câmera",
      "chamada de video",
      "chamada de vídeo",
    ],
  },
  {
    key: "personalInfoRequests",
    label: "Pedido de dado pessoal",
    onlyFrom: "other",
    expressions: [
      "onde voce mora",
      "onde você mora",
      "qual seu endereco",
      "qual seu endereço",
      "que escola",
      "qual escola",
      "seu telefone",
      "quantos anos voce tem",
      "quantos anos você tem",
      "esta sozinho",
      "está sozinho",
      "esta sozinha",
      "está sozinha",
    ],
  },
  {
    key: "isolationAttempts",
    label: "Tentativa de isolamento",
    onlyFrom: "other",
    expressions: [
      "so eu te entendo",
      "só eu te entendo",
      "ninguem te entende",
      "ninguém te entende",
      "seus pais nao",
      "seus pais não",
      "seus amigos nao",
      "seus amigos não",
      "fala so comigo",
      "fala só comigo",
      "confia so em mim",
      "confia só em mim",
    ],
  },
  {
    key: "threats",
    label: "Ameaça",
    expressions: [
      "voce vai se arrepender",
      "você vai se arrepender",
      "vou te encontrar",
      "sei onde voce",
      "sei onde você",
      "vai dar ruim",
      "te pego",
    ],
  },
  {
    key: "insults",
    label: "Hostilidade / insulto",
    expressions: ["idiota", "burro", "burra", "ninguem gosta", "ninguém gosta", "some daqui", "otario", "otário"],
  },
  {
    key: "blackmailAttempts",
    label: "Chantagem",
    expressions: [
      "se voce contar",
      "se você contar",
      "vou mostrar pra",
      "mando pra todo mundo",
      "espalho",
      "todo mundo vai ver",
    ],
  },
  {
    key: "sexualContentSignals",
    label: "Conteúdo impróprio",
    onlyFrom: "other",
    // Restrito a insinuações de intimidade. Marcadores de sigilo ("só entre a
    // gente") ficam em `secrecyRequests` — rotulá-los como sexual inflaria a
    // categoria mais grave em cima de uma frase ambígua.
    expressions: ["voce e madura", "você é madura", "voce e mais madura", "coisa de adulto", "coisa de gente grande"],
  },
  {
    key: "emotionalDistressSignals",
    label: "Sofrimento emocional",
    onlyFrom: "child",
    expressions: [
      "to triste",
      "tô triste",
      "estou triste",
      "cansado de tudo",
      "cansada de tudo",
      "ninguem liga",
      "ninguém liga",
      "me sinto sozinho",
      "me sinto sozinha",
      "nao aguento",
      "não aguento",
    ],
  },
  {
    key: "selfHarmSignals",
    label: "Risco de automutilação",
    onlyFrom: "child",
    expressions: ["me machucar", "sumir de vez", "nao quero mais viver", "não quero mais viver", "desaparecer pra sempre"],
  },
];

/** Normaliza para casar sem depender de acento/caixa. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Mensagens que dispararam cada padrão (ids opacos — nunca o texto). */
export interface PatternHit {
  key: keyof ConversationFeatures;
  label: string;
  messageIds: string[];
}

export interface ExtractionResult {
  features: ConversationFeatures;
  hits: PatternHit[];
}

/**
 * Percorre a conversa uma vez e conta ocorrências por padrão, guardando os ids
 * das mensagens que casaram (para rastreabilidade sem expor conteúdo).
 */
export function extractFeatures(conversation: Conversation): ExtractionResult {
  const counts = new Map<keyof ConversationFeatures, string[]>();

  for (const message of conversation.messages) {
    const haystack = normalize(message.text);
    for (const pattern of PATTERNS) {
      if (pattern.onlyFrom && message.author !== pattern.onlyFrom) continue;
      const matched = pattern.expressions.some((expr) => haystack.includes(normalize(expr)));
      if (!matched) continue;
      const ids = counts.get(pattern.key) ?? [];
      if (!ids.includes(message.id)) ids.push(message.id);
      counts.set(pattern.key, ids);
    }
  }

  const count = (key: keyof ConversationFeatures): number => counts.get(key)?.length ?? 0;

  const suspiciousIds = new Set<string>();
  for (const ids of counts.values()) ids.forEach((id) => suspiciousIds.add(id));

  const features: ConversationFeatures = {
    secrecyRequests: count("secrecyRequests"),
    imageRequests: count("imageRequests"),
    personalInfoRequests: count("personalInfoRequests"),
    isolationAttempts: count("isolationAttempts"),
    threats: count("threats"),
    insults: count("insults"),
    blackmailAttempts: count("blackmailAttempts"),
    sexualContentSignals: count("sexualContentSignals"),
    emotionalDistressSignals: count("emotionalDistressSignals"),
    selfHarmSignals: count("selfHarmSignals"),
    messageCount: conversation.messages.length,
    suspiciousMessageCount: suspiciousIds.size,
    conversationEscalation: escalation(conversation, suspiciousIds),
  };

  const hits: PatternHit[] = [];
  for (const pattern of PATTERNS) {
    const ids = counts.get(pattern.key);
    if (ids && ids.length > 0) hits.push({ key: pattern.key, label: pattern.label, messageIds: ids });
  }

  return { features, hits };
}

/**
 * Escalada 0–1: proporção de mensagens suspeitas na METADE FINAL da conversa.
 * Um diálogo que só fica pesado no fim é mais preocupante do que um ruído
 * isolado no começo — é o padrão clássico de aproximação gradual.
 */
function escalation(conversation: Conversation, suspiciousIds: Set<string>): number {
  const total = conversation.messages.length;
  if (total === 0) return 0;
  const secondHalf = conversation.messages.slice(Math.floor(total / 2));
  if (secondHalf.length === 0) return 0;
  const suspiciousInTail = secondHalf.filter((m) => suspiciousIds.has(m.id)).length;
  return Number((suspiciousInTail / secondHalf.length).toFixed(2));
}

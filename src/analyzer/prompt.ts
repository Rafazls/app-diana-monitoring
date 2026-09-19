import { z } from "zod";
import type { Conversation } from "../contracts/index.js";
import { SIGNAL_WEIGHTS } from "./riskEngine.js";

/** Tipos de sinal que o modelo pode usar — o mesmo vocabulário da heurística. */
export const SIGNAL_TYPES = Object.keys(SIGNAL_WEIGHTS);

export const llmResponseSchema = z.object({
  signals: z.array(
    z.object({
      type: z.enum(SIGNAL_TYPES as [string, ...string[]]),
      messageIds: z.array(z.string()).min(1),
      confidence: z.number().min(0).max(1),
      severity: z.enum(["low", "medium", "high"]),
      rationale: z.string().max(500).optional(),
    }),
  ),
});

export type LlmResponse = z.infer<typeof llmResponseSchema>;

const CATALOGO = `
- secrecy_request: pedir que a conversa fique em segredo, que não conte aos pais, apagar mensagens
- image_request: pedir foto, vídeo, ligar a câmera, chamada de vídeo
- personal_information_request: perguntar endereço, escola, rotina, telefone, idade, se está sozinho
- isolation_attempt: afastar a criança de pais e amigos, se colocar como único confiável
- threat: intimidar, ameaçar de qualquer forma
- insult: xingar, humilhar, hostilizar
- blackmail: coagir com ameaça de expor algo
- sexual_language: insinuação de intimidade ou conteúdo impróprio para a idade
- emotional_distress: a CRIANÇA expressa tristeza, solidão, cansaço, desesperança
- self_harm: a CRIANÇA menciona se machucar, sumir, não querer viver`;

export const SYSTEM_PROMPT = `Você analisa conversas para proteção infantil. Sua tarefa é identificar SINAIS de risco — não julgar pessoas nem afirmar que houve crime.

CATÁLOGO DE SINAIS (use exatamente estes identificadores):${CATALOGO}

REGRAS:
1. Analise o contexto e a PROGRESSÃO da conversa, não mensagens isoladas. Aproximação abusiva costuma ser gradual: elogio, vínculo, segredo, isolamento, pedido.
2. Considere QUEM fala. secrecy_request, image_request, personal_information_request, isolation_attempt e sexual_language só contam vindos de "other" (o interlocutor). emotional_distress e self_harm só contam vindos de "child".
3. Reporte apenas sinais que você realmente identificou. Não invente para parecer útil: um falso alerta desgasta a confiança do responsável e pode expor a criança a uma conversa desnecessária com os pais.
4. Em messageIds, liste os ids EXATOS das mensagens que sustentam o sinal.
5. confidence entre 0 e 1. severity: "high" para pedido de imagem, chantagem, automutilação e conteúdo sexual; "medium" para segredo, isolamento, ameaça; "low" para o resto.
6. Se não houver nenhum sinal, devolva {"signals": []}.

Responda SOMENTE com JSON válido, sem markdown, sem explicação fora do JSON:
{"signals":[{"type":"...","messageIds":["..."],"confidence":0.0,"severity":"low|medium|high","rationale":"..."}]}`;

/** Serializa a janela de conversa para o modelo ler. */
export function buildUserPrompt(conversation: Conversation): string {
  const linhas = conversation.messages.map((m) => {
    const quem = m.author === "child" ? "CRIANÇA" : "OUTRO";
    const hora = new Date(m.timestamp).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `[${m.id}] (${hora}) ${quem}: ${m.text}`;
  });

  return `Conversa a analisar (${conversation.messages.length} mensagens, em ordem cronológica):

${linhas.join("\n")}

Identifique os sinais de risco e responda em JSON.`;
}

/**
 * Extrai o JSON da resposta do modelo.
 *
 * Modelos costumam embrulhar em ```json apesar da instrução; isso é previsível
 * o bastante para tratar, em vez de rejeitar a análise inteira por causa de
 * três crases.
 */
export function extractJson(raw: string): unknown {
  const semCerca = raw
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes("```") ? "" : m))
    .replace(/```[\s\S]*$/i, "")
    .trim();

  const candidato = semCerca.startsWith("{") ? semCerca : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(candidato);
}

export interface ParseOutcome {
  ok: boolean;
  response?: LlmResponse;
  error?: string;
}

/** Valida a resposta contra o schema. Nunca lança. */
export function parseLlmResponse(raw: string): ParseOutcome {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch {
    return { ok: false, error: "resposta não continha JSON válido" };
  }

  const parsed = llmResponseSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: issues };
  }

  return { ok: true, response: parsed.data };
}

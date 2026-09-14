/**
 * Conversas de demonstração — o "mundo real" simulado que alimenta a demo.
 *
 * Substituem a ingestão do Telegram para que a demo rode sem bot, sem token e
 * sem dados de ninguém. Os diálogos são FICTÍCIOS e foram escritos para
 * exercitar os padrões que o analisador precisa reconhecer (pedido de segredo,
 * isolamento, pedido de imagem, chantagem, hostilidade, sofrimento emocional),
 * de forma ilustrativa e sem conteúdo gráfico.
 *
 * Inclui de propósito uma conversa INOFENSIVA: um sistema que alerta sobre tudo
 * é tão inútil quanto um que não alerta sobre nada — a demo precisa mostrar o
 * filtro funcionando.
 */
import type { Conversation, ConversationMessage } from "@diana/contracts";

/** Monta as mensagens alternando horários em minutos a partir de `startedAt`. */
function messages(
  prefix: string,
  startedAt: string,
  entries: Array<[ConversationMessage["author"], string]>,
): ConversationMessage[] {
  const base = new Date(startedAt).getTime();
  return entries.map(([author, text], index) => ({
    id: `${prefix}-MSG-${String(index + 1).padStart(3, "0")}`,
    author,
    text,
    timestamp: new Date(base + index * 4 * 60_000).toISOString(),
  }));
}

const GROOMING_STARTED = "2026-09-13T19:10:00.000Z";
const BLACKMAIL_STARTED = "2026-09-14T00:35:00.000Z";
const BULLYING_STARTED = "2026-09-13T21:05:00.000Z";
const DISTRESS_STARTED = "2026-09-14T02:15:00.000Z";
const BENIGN_STARTED = "2026-09-14T13:40:00.000Z";

export const demoConversations: Conversation[] = [
  {
    id: "conv-grooming-01",
    childId: "child-lucas",
    childName: "Lucas",
    contactId: "contact-bruno",
    contactName: "Bruno_GamerPro",
    startedAt: GROOMING_STARTED,
    messages: messages("GRM", GROOMING_STARTED, [
      ["other", "eae, joguei contigo ontem, tu é muito bom nesse game"],
      ["child", "vlw kkkk to treinando"],
      ["other", "vou te dar uns itens raros, mas fica só entre a gente tá? nosso segredo"],
      ["child", "serio? obrigado!!"],
      ["other", "serio sim. vc é diferente dos outros, só eu te entendo de verdade"],
      ["child", "meus amigos acham que eu jogo demais"],
      ["other", "viu? seus amigos não te valorizam. fala só comigo que eu te ajudo"],
      ["other", "quantos anos você tem mesmo? e que escola vc estuda?"],
      ["child", "12, estudo no colegio perto de casa"],
      ["other", "legal. você está sozinho em casa agora?"],
      ["child", "to sim, meus pais chegam tarde"],
      ["other", "manda uma foto sua pra eu ver, depois apaga essa conversa"],
    ]),
  },
  {
    id: "conv-blackmail-01",
    childId: "child-pedro",
    childName: "Pedro",
    contactId: "contact-dani",
    contactName: "DaniOnline",
    startedAt: BLACKMAIL_STARTED,
    messages: messages("BLK", BLACKMAIL_STARTED, [
      ["other", "oi, vi que vc entrou no grupo"],
      ["child", "oi, entrei ontem"],
      ["other", "tira uma foto sua agora, rapidinho"],
      ["child", "pra que?"],
      ["other", "se você contar isso pra alguém eu mando pra todo mundo da sua sala"],
      ["child", "para, to com medo"],
      ["other", "então faz o que eu pedi. ninguém precisa saber"],
      ["other", "e não conta pros seus pais, senão espalho"],
    ]),
  },
  {
    id: "conv-bullying-01",
    childId: "child-marina",
    childName: "Marina",
    contactId: "contact-colega",
    contactName: "Colega da escola",
    startedAt: BULLYING_STARTED,
    messages: messages("BUL", BULLYING_STARTED, [
      ["other", "vc é muito burra mesmo"],
      ["child", "para com isso"],
      ["other", "ninguem gosta de vc na sala, some daqui"],
      ["child", "eu nao fiz nada"],
      ["other", "amanha vai dar ruim pra vc, te pego na saida"],
      ["child", "vou falar com a professora"],
    ]),
  },
  {
    id: "conv-distress-01",
    childId: "child-marina",
    childName: "Marina",
    contactId: "contact-amiga",
    contactName: "Sofia",
    startedAt: DISTRESS_STARTED,
    messages: messages("DST", DISTRESS_STARTED, [
      ["child", "oi so, ainda acordada?"],
      ["other", "to sim, que foi?"],
      ["child", "to triste, ninguem liga pra mim"],
      ["other", "eu ligo! aconteceu alguma coisa na escola?"],
      ["child", "me sinto sozinha, to cansada de tudo"],
      ["other", "vc quer conversar amanha? posso ir na sua casa"],
      ["child", "as vezes eu queria desaparecer pra sempre"],
      ["other", "marina, fala com sua mãe por favor"],
    ]),
  },
  {
    id: "conv-benign-01",
    childId: "child-lucas",
    childName: "Lucas",
    contactId: "contact-tia",
    contactName: "Tia Cláudia",
    startedAt: BENIGN_STARTED,
    messages: messages("BEN", BENIGN_STARTED, [
      ["other", "oi Lucas! tudo bem? feliz aniversário atrasado 🎉"],
      ["child", "oi tia! tudo sim, obrigado!"],
      ["other", "gostou do presente? escolhi junto com sua prima"],
      ["child", "amei! ja montei o lego todo"],
      ["other", "que bom! manda foto pra sua mãe mostrar pra gente no domingo"],
      ["child", "pode deixar, vou mostrar no almoço"],
    ]),
  },
];

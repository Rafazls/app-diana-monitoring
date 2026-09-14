#!/usr/bin/env node
/**
 * Simulador da Bot API do Telegram — para testar a ingestão sem bot real.
 *
 * POR QUE ISSO EXISTE: a Bot API não permite enviar mensagem "como" outra
 * pessoa — um bot só fala como ele mesmo. Para ver os dois lados de uma
 * conversa (criança e interlocutor) seriam necessárias duas contas de Telegram.
 * Este simulador responde `getMe` e `getUpdates` exatamente como o Telegram
 * responderia, então o backend exercita o CÓDIGO REAL de ingestão — o laço de
 * long polling, o `offset`, a janela por silêncio, o mapeamento de autor — e só
 * a origem das mensagens é falsa.
 *
 * Uso:
 *   node tools/telegram-sim.mjs                  # modo interativo
 *   node tools/telegram-sim.mjs --roteiro grooming   # reproduz uma conversa
 *   node tools/telegram-sim.mjs --roteiro listar     # mostra os roteiros
 *
 * E, em outro terminal, o backend apontado para cá:
 *   INGESTION=telegram TELEGRAM_BOT_TOKEN=teste TELEGRAM_CHILD_ID=111 \
 *   TELEGRAM_API_BASE=http://localhost:8081 TELEGRAM_IDLE_MS=3000 \
 *   CHILD_NAME=Lucas npm start
 */
import http from "node:http";
import readline from "node:readline";

const PORT = Number(process.env.SIM_PORT ?? 8081);
const CHAT_ID = Number(process.env.SIM_CHAT_ID ?? -1001234567890);

/** Precisa bater com TELEGRAM_CHILD_ID do backend. */
const CHILD_ID = Number(process.env.SIM_CHILD_ID ?? 111);
const CHILD_NAME = process.env.SIM_CHILD_NAME ?? "Lucas";
const OTHER_ID = Number(process.env.SIM_OTHER_ID ?? 222);
const OTHER_NAME = process.env.SIM_OTHER_NAME ?? "Bruno_GamerPro";

/** Fila de updates ainda não entregues, no formato da Bot API. */
const updates = [];

/**
 * Os ids começam no relógio (segundos desde a época) em vez de 1.
 *
 * O backend guarda o offset de onde parou. Se o simulador reiniciasse contando
 * de 1 de novo, o backend pediria ids muito à frente dos que existem e ficaria
 * cego — sem erro, sem log, só silêncio. Começar do relógio garante que cada
 * execução emite ids maiores que os da anterior.
 */
let nextUpdateId = Math.floor(Date.now() / 1000);
let nextMessageId = 1;

/** Requisições de getUpdates esperando (long polling). */
let waiting = [];

function enqueue(author, text) {
  const isChild = author === "child";
  updates.push({
    update_id: nextUpdateId++,
    message: {
      message_id: nextMessageId++,
      date: Math.floor(Date.now() / 1000),
      text,
      from: {
        id: isChild ? CHILD_ID : OTHER_ID,
        is_bot: false,
        first_name: isChild ? CHILD_NAME : OTHER_NAME,
      },
      chat: { id: CHAT_ID, type: "group", title: "Conversa monitorada (simulada)" },
    },
  });

  const quem = isChild ? `${CHILD_NAME} (criança)` : `${OTHER_NAME} (contato)`;
  console.log(`  → ${quem}: ${text}`);

  // Acorda quem estiver esperando por updates.
  const pending = waiting;
  waiting = [];
  for (const resolve of pending) resolve();
}

function pendingFrom(offset) {
  return updates.filter((u) => u.update_id >= offset);
}

function reply(res, result) {
  const body = JSON.stringify({ ok: true, result });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // A rota é /bot<token>/<metodo> — o token não importa aqui.
  const method = (req.url ?? "").split("/").pop() ?? "";

  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = body ? JSON.parse(body) : {};

  if (method === "getMe") {
    return reply(res, { id: 999, is_bot: true, username: "diana_sim_bot" });
  }

  if (method === "getUpdates") {
    const offset = Number(payload.offset ?? 0);
    const timeoutSec = Number(payload.timeout ?? 25);

    /**
     * Se o backend já está num offset à frente do nosso contador, ele guardou
     * a posição de uma execução anterior do simulador. No Telegram real os
     * update_id são persistentes; aqui eles reiniciam junto com o processo.
     * Sem este ajuste, reiniciar o simulador deixaria o backend cego — pedindo
     * ids que nunca chegariam — e em silêncio, que é o pior tipo de falha.
     */
    if (offset > nextUpdateId) {
      nextUpdateId = offset;
      console.log(`  (alinhando ao offset ${offset} que o backend pediu)`);
    }

    const ready = pendingFrom(offset);
    if (ready.length > 0) return reply(res, ready);

    // Long polling de verdade: segura a resposta até chegar mensagem ou expirar.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutSec * 1000);
      waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    return reply(res, pendingFrom(offset));
  }

  return reply(res, true);
});

/**
 * Roteiros prontos. Os diálogos são fictícios e ilustram os padrões que o
 * analisador reconhece, sem conteúdo gráfico.
 */
const roteiros = {
  grooming: [
    ["other", "eae, joguei contigo ontem, tu é muito bom nesse game"],
    ["child", "vlw kkkk to treinando"],
    ["other", "vou te dar uns itens raros, mas fica só entre a gente tá? nosso segredo"],
    ["child", "serio? obrigado!!"],
    ["other", "vc é diferente dos outros, só eu te entendo de verdade"],
    ["child", "meus amigos acham que eu jogo demais"],
    ["other", "viu? seus amigos não te valorizam. fala só comigo que eu te ajudo"],
    ["other", "quantos anos você tem mesmo? e que escola vc estuda?"],
    ["child", "12, estudo no colegio perto de casa"],
    ["other", "você está sozinho em casa agora?"],
    ["child", "to sim, meus pais chegam tarde"],
    ["other", "manda uma foto sua pra eu ver, depois apaga essa conversa"],
  ],
  chantagem: [
    ["other", "oi, vi que vc entrou no grupo"],
    ["child", "oi, entrei ontem"],
    ["other", "tira uma foto sua agora, rapidinho"],
    ["child", "pra que?"],
    ["other", "se você contar isso pra alguém eu mando pra todo mundo da sua sala"],
    ["child", "para, to com medo"],
    ["other", "então faz o que eu pedi. ninguém precisa saber"],
  ],
  bullying: [
    ["other", "vc é muito burra mesmo"],
    ["child", "para com isso"],
    ["other", "ninguem gosta de vc na sala, some daqui"],
    ["child", "eu nao fiz nada"],
    ["other", "amanha vai dar ruim pra vc, te pego na saida"],
  ],
  sofrimento: [
    ["child", "oi, ainda acordada?"],
    ["other", "to sim, que foi?"],
    ["child", "to triste, ninguem liga pra mim"],
    ["other", "eu ligo! aconteceu alguma coisa na escola?"],
    ["child", "me sinto sozinha, to cansada de tudo"],
    ["child", "as vezes eu queria desaparecer pra sempre"],
  ],
  tranquila: [
    ["other", "oi! tudo bem? feliz aniversário atrasado 🎉"],
    ["child", "oi tia! tudo sim, obrigado!"],
    ["other", "gostou do presente? escolhi junto com sua prima"],
    ["child", "amei! ja montei o lego todo"],
  ],
};

function ajuda() {
  console.log(`
Comandos:
  <texto>            fala como ${OTHER_NAME} (o contato)
  c: <texto>         fala como ${CHILD_NAME} (a criança)
  o: <texto>         fala como ${OTHER_NAME} (o contato)
  /roteiro <nome>    reproduz uma conversa inteira
  /roteiros          lista os roteiros disponíveis
  /ajuda             mostra isto
  /sair              encerra
`);
}

async function reproduzir(nome, pausaMs = 250) {
  const roteiro = roteiros[nome];
  if (!roteiro) {
    console.log(`Roteiro "${nome}" não existe. Disponíveis: ${Object.keys(roteiros).join(", ")}`);
    return;
  }
  console.log(`\n▶ Reproduzindo "${nome}" (${roteiro.length} mensagens):`);
  for (const [author, text] of roteiro) {
    enqueue(author, text);
    await new Promise((r) => setTimeout(r, pausaMs));
  }
  console.log(`\n✓ Fim do roteiro. O backend analisa quando a janela fechar.\n`);
}

server.listen(PORT, async () => {
  console.log(`
┌──────────────────────────────────────────────────────────────┐
│  Simulador da Bot API do Telegram                            │
└──────────────────────────────────────────────────────────────┘

Ouvindo em   http://localhost:${PORT}
Chat         ${CHAT_ID}
Criança      ${CHILD_NAME} (id ${CHILD_ID})   ← use em TELEGRAM_CHILD_ID
Contato      ${OTHER_NAME} (id ${OTHER_ID})

No outro terminal, suba o backend apontando para cá:

  INGESTION=telegram TELEGRAM_BOT_TOKEN=teste \\
  TELEGRAM_CHILD_ID=${CHILD_ID} TELEGRAM_API_BASE=http://localhost:${PORT} \\
  TELEGRAM_IDLE_MS=3000 CHILD_NAME=${CHILD_NAME} npm start
`);

  const args = process.argv.slice(2);
  const idx = args.indexOf("--roteiro");

  if (idx !== -1) {
    const nome = args[idx + 1];
    if (!nome || nome === "listar") {
      console.log(`Roteiros: ${Object.keys(roteiros).join(", ")}\n`);
      process.exit(0);
    }
    await reproduzir(nome);
    console.log("Simulador segue no ar (Ctrl+C para sair).\n");
    return;
  }

  ajuda();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();

    if (input === "/sair") return process.exit(0);
    if (input === "/ajuda") {
      ajuda();
    } else if (input === "/roteiros") {
      console.log(`Roteiros: ${Object.keys(roteiros).join(", ")}`);
    } else if (input.startsWith("/roteiro ")) {
      await reproduzir(input.slice(9).trim());
    } else if (input.startsWith("c:")) {
      enqueue("child", input.slice(2).trim());
    } else if (input.startsWith("o:")) {
      enqueue("other", input.slice(2).trim());
    } else {
      enqueue("other", input);
    }

    rl.prompt();
  });
});

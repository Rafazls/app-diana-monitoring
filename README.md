# DIANA · backend

Conecta ao Telegram, analisa as conversas e serve os alertas ao app do
responsável ([`app-diana-guardian-web`](#o-front-end)).

```bash
npm install
npm run build
npm start
```

Sobe em **http://localhost:8080** com conversas de exemplo — sem bot, sem token,
sem credencial. A saída mostra a triagem acontecendo:

```
🚨 Alerta para Lucas: critical (score 98, 4 sinais).
🚨 Alerta para Pedro: critical (score 93, 3 sinais).
🚨 Alerta para Marina: high (score 52, 2 sinais).
🚨 Alerta para Marina: medium (score 31, 2 sinais).
Conversa conv-benign-01 analisada e descartada (score 0, sem risco relevante).
```

A última linha é de propósito: **um sistema que alerta sobre tudo é tão inútil
quanto um que não alerta sobre nada.**

## O caminho de uma conversa

```
Telegram (ou fixtures)
        │  Conversation
        ▼
    analyzer            heurística determinística (ou OCI Generative AI)
        │  AnalysisResult  ← já sem texto e sem identidade
        ▼
   pipeline             decide o que merece a atenção do responsável
        │  AlertRecord
        ▼
  API HTTP :8080        projeta para a forma exata que a tela consome
```

## A regra que organiza o projeto (RF-16)

> O responsável recebe a **análise do risco** — nunca a conversa do filho.

Três camadas independentes garantem isso:

1. O `AnalysisResult` é **identity-free**: nada de texto de mensagem, nome da
   criança ou do contato — só sinais, pesos e referências opacas (`TG-123-45`)
   que permitem auditoria sem exposição.
2. A projeção para a tela usa **allowlist** — cada campo entregue é escolhido a
   dedo, então um campo novo no contrato não vaza por descuido.
3. Antes de serializar, uma **asserção defensiva** varre o payload atrás de
   chaves de conteúdo bruto e aborta se encontrar.

Há teste automatizado: cada resposta da API é comparada contra o texto original
de todas as conversas de exemplo.

## API

| Rota | O que devolve |
|---|---|
| `GET /health` | Status, fonte de ingestão, motor de análise e contadores. |
| `GET /dashboard` | `stats`, `activity` (7 dias) e `recentAlerts` — a tela de início. |
| `GET /alerts` | Lista de alertas (`id`, `title`, `child`, `time`, `priority`, `read`, `category`). |
| `GET /alerts/:id` | `{ analysis, childName, detectedTime }` — o detalhe. Marca como lido. |
| `POST /alerts/:id/feedback` | `useful` · `false_positive` · `not_sure` (+ nota opcional). |
| `GET` · `PUT /settings` | Preferências do responsável. |

Erros previsíveis: `400` entrada inválida, `404` alerta inexistente,
`503` fonte de alertas indisponível.

## Testando a ingestão sem bot e sem conta

A Bot API **não permite enviar mensagem "como" outra pessoa** — um bot só fala
como ele mesmo. Para ver os dois lados de uma conversa no Telegram de verdade
seriam necessárias duas contas num grupo com o bot.

Para testar antes disso, o repositório traz um **simulador da Bot API**. Ele
responde `getMe` e `getUpdates` exatamente como o Telegram, então o backend
exercita o código real de ingestão — long polling, `offset`, janela por
silêncio, mapeamento de autor — e só a origem das mensagens é falsa.

**Terminal 1** — simulador:

```bash
node tools/telegram-sim.mjs
```

**Terminal 2** — backend apontado para ele:

```bash
INGESTION=telegram TELEGRAM_BOT_TOKEN=teste TELEGRAM_CHILD_ID=111 \
TELEGRAM_API_BASE=http://localhost:8081 TELEGRAM_IDLE_MS=3000 \
CHILD_NAME=Lucas npm start
```

No simulador, escolha quem fala:

```
> o: oi, joguei contigo ontem          # o contato
> c: vlw kkkk                          # a criança
> o: fica só entre a gente, tá?
> /roteiro grooming                    # ou reproduza uma conversa inteira
> /roteiros                            # grooming, chantagem, bullying, sofrimento, tranquila
```

Passados os 3 segundos de silêncio (`TELEGRAM_IDLE_MS`), o backend fecha a
janela, analisa e o alerta aparece em `GET /alerts` e na tela do responsável.

## Ligando o Telegram de verdade

1. Crie um bot com o [@BotFather](https://t.me/BotFather) e copie o token.
2. Adicione o bot ao chat que será monitorado (com ciência e consentimento de
   quem participa dele).
3. Descubra o id numérico da criança no Telegram e configure:

```bash
INGESTION=telegram
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHILD_ID=987654321
CHILD_NAME=Lucas
```

**O que o bot enxerga:** a Bot API entrega ao bot apenas mensagens de chats em
que ele foi adicionado — e, em grupos, apenas as dirigidas a ele, a menos que o
dono do bot desligue o modo privacidade. Não existe, e este código não tenta,
leitura de conversas alheias. Monitorar a comunicação de uma criança é uma
decisão da família, e deve ser feita com transparência com ela.

**Janela de análise:** mensagens são acumuladas por chat e analisadas quando a
conversa "amadurece" (20s de silêncio ou 40 mensagens), com contexto das últimas
6 horas — analisar a cada tecla digitada seria caro e pioraria a precisão.

## Comandos

```bash
npm start       # sobe a API (build primeiro)
npm run build   # compila
npm run check   # typecheck + testes
npm test        # só os testes
```

## Limites honestos

- **`ANALYZER=oci` não está implementado.** Existe como interface e falha no
  boot se escolhido — nunca silenciosamente, nem com resultado inventado.
- **A heurística é um baseline, não um classificador.** Casa expressões
  conhecidas; erra em ironia, gíria e contexto. Por isso todo alerta carrega os
  sinais que o justificaram: a decisão final é de um humano.
- **Não há autenticação.** A chave opcional (`x-api-key`) é um freio de
  demonstração: sem identidade, sem autorização por responsável.
- **`STORE=memory` perde os alertas no reinício.** Use `STORE=file` para
  persistir.

## O front-end

A tela do responsável vive em um repositório separado e consome esta API.
Configure lá a URL deste backend (padrão `http://localhost:8080`).

## Se você chegou aqui por um caso real

**Disque 100** (violência contra crianças e adolescentes) e **CVV 188** (apoio
emocional) são gratuitos e funcionam 24h no Brasil.

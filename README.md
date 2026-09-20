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

## Definição oficial da DIANA

### O que é a DIANA?

A **DIANA** é uma plataforma de proteção digital infantil baseada em análise
contextual de conversas. Ela:

1. captura periodicamente dados de uma fonte de conversa (hoje, o Telegram);
2. organiza e protege esses dados, sem expor o conteúdo bruto a ninguém além
   do próprio pipeline de análise;
3. reconstrói uma janela temporal de contexto a partir dos lotes de mensagens
   recentes de uma conversa;
4. interpreta padrões comportamentais nessa janela;
5. identifica sinais associados a categorias de risco (aliciamento, ameaça,
   pedido de imagem, autolesão, entre outras);
6. consolida esses sinais em uma pontuação de risco (score, nível e
   prioridade);
7. gera um **alerta estruturado** quando há evidência suficiente para
   justificar a atenção do responsável.

### O que a DIANA não é?

A DIANA não é:

- um aplicativo de espionagem;
- um sistema que mostra ao responsável a conversa inteira — a regra RF-16
  (abaixo) impede isso por construção;
- um filtro baseado exclusivamente em palavras proibidas;
- um mecanismo que classifica cada mensagem isoladamente, sem contexto;
- um sistema que rotula uma pessoa como criminosa;
- uma afirmação de que um abuso ocorreu só porque uma classificação
  probabilística disparou — todo alerta carrega os sinais que o justificam, e
  a decisão final é sempre de um humano.

### Arquitetura geral

A DIANA é composta por dois repositórios que se comunicam por HTTP:

```
┌──────────────────────── app-diana-monitoring (este repositório) ────────────────────────┐
│                                                                                            │
│  Telegram / fixtures → ingestion → BatchScheduler → analyzer → AlertStore                │
│                                          │                │                               │
│                                 (janela de contexto)  (mock | server | oci)                │
│                                                                       │                    │
│                                                                API HTTP Fastify :8080       │
└────────────────────────────────────────────────────────────────────┬────────────────────┘
                                                                       │ REST (/dashboard, /alerts, /settings…)
                                                                       ▼
                                                     app-diana-guardian-web (React + Vite)
                                                     tela do responsável — só a análise, nunca a conversa
```

- **Ingestão** (`src/ingestion`) — lê mensagens do Telegram via long polling
  ou reproduz conversas de exemplo (`FixtureSource`), sem qualquer rede.
- **Batch/scheduler** (`src/batch`) — acumula mensagens por conversa e, a cada
  `BATCH_INTERVAL_MS`, fecha a janela, monta o contexto das últimas
  `CONTEXT_BATCHES` janelas e dispara a análise, com proteção contra ticks
  sobrepostos.
- **Analyzer** (`src/analyzer`) — três motores plugáveis atrás da mesma
  interface (heurística, servidor de modelo próprio ou OCI Generative AI) —
  ver seção seguinte.
- **Store** (`src/store`) — persiste alertas e batches em memória, arquivo ou
  Oracle Autonomous Database.
- **API HTTP** (`src/http`) — expõe `/health`, `/dashboard`, `/alerts`,
  `/alerts/:id`, `/alerts/:id/feedback` e `/settings`, sempre projetando a
  saída por allowlist (RF-16).

### Tecnologias, linguagens e frameworks

- **Linguagem**: TypeScript em modo estrito, Node.js ≥ 22, ESM.
- **Servidor HTTP**: [Fastify 4](https://fastify.dev/) + `@fastify/cors`.
- **Validação**: [Zod 3](https://zod.dev/) — schema de ambiente, contratos
  HTTP e schema da resposta do LLM.
- **SDKs Oracle Cloud**: `oci-common`, `oci-generativeaiinference` (OCI
  Generative AI) e `oracledb` (Oracle Autonomous Database).
- **Testes**: [Vitest](https://vitest.dev/).
- **Sem framework de front-end neste repositório** — a interface fica em
  [`app-diana-guardian-web`](https://github.com/Rafazls/app-diana-guardian-web)
  (React 18 + Vite + TypeScript + Tailwind CSS).

### APIs, modelos de Inteligência Artificial e bases de dados

O motor de análise (`ANALYZER`) é plugável entre três implementações, todas
atrás da mesma interface e do mesmo motor de pontuação (`riskEngine.ts`):

| `ANALYZER` | Motor | Uso |
|---|---|---|
| `mock` (padrão) | Heurística determinística em português (regex/palavras-chave sobre 10 tipos de sinal) | Demonstração, testes, ambiente sem custo e sem rede |
| `server` | Qualquer API **compatível com OpenAI** (`POST {MODEL_SERVER_URL}/chat/completions`) — llama.cpp, Ollama, vLLM, LM Studio, TGI | Modelo próprio, local ou auto-hospedado (recomendado: **Qwen2.5-3B-Instruct**, quantizado) |
| `oci` | [OCI Generative AI Inference](https://www.oracle.com/artificial-intelligence/generative-ai/) (famílias `cohere` ou `generic`) | Modelo gerenciado na Oracle Cloud |

Todas as respostas do LLM passam por um schema Zod estrito (somente JSON,
catálogo fixo de sinais) antes de virar pontuação — nunca texto livre chega
ao responsável.

**Bases de dados / armazenamento** (`STORE`):

| `STORE` | Onde fica |
|---|---|
| `memory` (padrão) | Em processo — perdido a cada reinício |
| `file` | JSON em `STATE_DIR` |
| `oracle` | **Oracle Autonomous Database** (`oracledb`, com suporte a wallet/mTLS) — tabelas `diana_alerts` e `diana_batches`, criadas automaticamente no primeiro boot |

### Executando tudo localmente (LLM em Docker → backend → front-end)

O quickstart no topo deste README já sobe o backend sozinho com o motor
`mock` (sem IA, sem Docker). Para rodar a solução completa — com um modelo de
linguagem de verdade e a tela do responsável — localmente:

**1. Suba um modelo compatível com OpenAI via Docker** (pule se for usar
`ANALYZER=mock`):

```bash
docker run -d --name diana-llm -p 11434:11434 -v diana-ollama:/root/.ollama ollama/ollama
docker exec diana-llm ollama pull qwen2.5:3b-instruct
```

Isso expõe um endpoint compatível com OpenAI em `http://localhost:11434/v1`.
Para hospedar em VM própria (inclusive no Always Free da Oracle) em vez de
local, veja [`docs/modelo-proprio.md`](docs/modelo-proprio.md), que também
cobre `llama.cpp`.

**2. Suba este backend apontando para o modelo:**

```bash
git clone git@github.com:Rafazls/app-diana-monitoring.git
cd app-diana-monitoring
npm install
cp .env.example .env
```

No `.env`, defina:

```ini
ANALYZER=server
MODEL_SERVER_URL=http://localhost:11434/v1
MODEL_SERVER_MODEL=qwen2.5:3b-instruct
```

```bash
npm run build && npm start   # http://localhost:8080
```

**3. Suba o front-end** (repositório separado):

```bash
git clone git@github.com:Rafazls/app-diana-guardian-web.git
cd app-diana-guardian-web
npm install
npm run dev   # http://localhost:5173, já com proxy para localhost:8080
```

**4. Conecte uma fonte de conversa de verdade (opcional):** siga
[Ligando o Telegram de verdade](#ligando-o-telegram-de-verdade) abaixo, ou
continue com as conversas de exemplo (`INGESTION=fixtures`, padrão) para
testar a integração ponta a ponta sem depender do Telegram.

Para persistir os alertas entre reinícios sem depender de um banco Oracle,
use `STORE=file` em vez do padrão `STORE=memory`.

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
2. **Desligue o modo privacidade** do bot (`/setprivacy` → `Disable` no
   @BotFather). Sem isso, em grupos o bot só recebe mensagens dirigidas a ele e
   a análise não vê a conversa.
3. Adicione o bot ao grupo que será monitorado (com ciência e consentimento de
   quem participa dele).
4. Descubra o id numérico da criança e configure um `.env` na raiz:

```bash
cp .env.example .env
```

```ini
INGESTION=telegram
TELEGRAM_BOT_TOKEN=123456:ABC...      # ← segredo: nunca versione nem compartilhe
TELEGRAM_CHILD_ID=987654321
CHILD_NAME=Lucas
```

O `npm start` carrega o `.env` automaticamente (`--env-file-if-exists`), e o
arquivo já está no `.gitignore`. Para descobrir os ids, mande uma mensagem no
grupo com cada conta e consulte:

```bash
curl "https://api.telegram.org/bot<SEU_TOKEN>/getUpdates" | jq '.result[].message.from'
```

**O que o bot enxerga:** a Bot API entrega ao bot apenas mensagens de chats em
que ele foi adicionado — e, em grupos, apenas as dirigidas a ele, a menos que o
dono do bot desligue o modo privacidade. Não existe, e este código não tenta,
leitura de conversas alheias. Monitorar a comunicação de uma criança é uma
decisão da família, e deve ser feita com transparência com ela.

**Janela de análise:** mensagens são acumuladas por chat e analisadas quando a
conversa "amadurece" (20s de silêncio ou 40 mensagens), com contexto das últimas
6 horas — analisar a cada tecla digitada seria caro e pioraria a precisão.

## Rodar o modelo em infraestrutura própria

Escolher um modelo, hospedar numa VM (inclusive no Always Free da Oracle) e
conectar à aplicação: [`docs/modelo-proprio.md`](docs/modelo-proprio.md).
Também cobre o caminho de treinamento.

## Provisionar na Oracle

Para provisionar o mesmo conjunto pelo terminal — compartimento, VCN, sub-rede,
NSG, instância e Autonomous Database, com script de criação e de teardown —
veja [`docs/infraestrutura-via-cli.md`](docs/infraestrutura-via-cli.md).

## Comandos

```bash
npm start       # sobe a API (build primeiro)
npm run build   # compila
npm run check   # typecheck + testes
npm test        # só os testes
```

## Limitações conhecidas

**1. Uma instância monitora uma única criança/conversa por vez.**
TELEGRAM_CHILD_ID e CHILD_NAME são valores únicos no .env — não há
suporte a múltiplas crianças ou múltiplos responsáveis na mesma
implantação (sem multi-tenant).

**2. Ingestão restrita ao Telegram.**
Depende do bot estar num grupo com o modo privacidade desligado; não enxerga DMs fora desse grupo nem outras
plataformas (WhatsApp, Instagram, Discord etc.).

**3. Motores de IA de verdade (server/oci) dependem de infraestrutura
externa**
Uma VM própria com o modelo rodando, ou uma conta OCI paga
(o tier Free do OCI Generative AI responde 429). Sem isso, só resta a
heurística.
**4. Modelo rodando em ARM (VM A2) é lento:**
35–60s por análise, contra
segundos em x86 com AVX512. Isso limita o quão "near-real-time" a
detecção pode ser nesse cenário de hospedagem.

**5. Persistência em Oracle Autonomous Database depende de wallet/mTLS**
Gerenciados manualmente fora do versionamento — não há rotação ou
gestão automatizada desse segredo.

## Próximos passos 
* Suporte a múltiplas crianças/conversas por implantação (modelo
multi-tenant), hoje limitado a uma por instância.
* Novas fontes de ingestão além do Telegram.
* Gestão de segredos (wallet do ADB, tokens) fora do .env local — um
cofre de segredos em vez de arquivo em disco.

## O front-end

A tela do responsável vive em um repositório separado e consome esta API.
Configure lá a URL deste backend (padrão `http://localhost:8080`).

## Se você chegou aqui por um caso real

**Disque 100** (violência contra crianças e adolescentes) e **CVV 188** (apoio
emocional) são gratuitos e funcionam 24h no Brasil.

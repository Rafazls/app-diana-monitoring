# DIANA · demo

Demo end-to-end da DIANA em um único repositório: uma conversa monitorada vira
uma **análise de risco**, que vira um **alerta estruturado** para o responsável.

Roda inteira na sua máquina, sem credencial, sem nuvem, sem bot.

```bash
npm install
npm run demo
```

Abra **http://localhost:5173**.

---

## O que acontece quando você roda

```
conversas de exemplo
        │
        ▼
  @diana/analyzer            heurística determinística (ou OCI Generative AI)
        │  AnalysisResult
        ▼
   @diana/core               decide o que merece alerta e grava em ./demo-state
        │  alerts/<conversa>/<data>.json
        ▼
@diana/guardian-api  :8080   serve o alerta JÁ RESUMIDO (REST)
        │
        ▼
@diana/guardian-web  :5173   painel do responsável
```

O `npm run demo` faz os três passos: analisa as conversas, sobe a API e abre o
painel. A saída do primeiro passo mostra a triagem acontecendo:

```
🚨 Lucas  ↔ Bruno_GamerPro      score  98/100 · critical · 4 sinal(is)
🚨 Pedro  ↔ DaniOnline          score  93/100 · critical · 3 sinal(is)
🚨 Marina ↔ Sofia               score  52/100 · high     · 2 sinal(is)
🚨 Marina ↔ Colega da escola    score  31/100 · medium   · 2 sinal(is)
✅ Lucas  ↔ Tia Cláudia         score   0/100 · none     · 0 sinal(is)
```

A última linha é de propósito: **um sistema que alerta sobre tudo é tão inútil
quanto um que não alerta sobre nada.** A conversa inofensiva é analisada e
descartada.

## A regra que organiza o projeto (RF-16)

> O responsável recebe a **análise do risco** — nunca a conversa do filho.

Isso não é um detalhe de implementação, é o que torna o produto aceitável para
uma família. Por isso a garantia aparece em três camadas independentes:

1. O `AnalysisResult` é **identity-free**: não carrega texto de mensagem, nem o
   nome da criança, nem o do contato — só sinais, pesos e referências opacas
   (`MSG-003`) que permitem auditoria sem exposição.
2. A API projeta a resposta por **allowlist** (cada campo é escolhido a dedo) e
   ainda roda uma **asserção defensiva** que aborta a serialização se um campo
   de conteúdo bruto aparecer por deriva de contrato.
3. O nome da criança é resolvido à parte, de um índice separado — quem tem
   direito de ver identidade resolve na hora de exibir, não no payload.

Há teste automatizado para isso: o resultado é serializado e comparado contra o
texto original de cada mensagem.

## Pacotes

| Pacote | Papel |
|---|---|
| `@diana/contracts` | A linguagem comum: `Conversation` → `AnalysisResult` → `AlertRecord`, os tipos de visão e o schema zod. Um único lugar define as formas. |
| `@diana/analyzer` | Decide o risco. `MockRiskAnalyzer` (padrão) ou `OciRiskAnalyzer` (seam pronto), atrás da mesma interface. |
| `@diana/core` | O núcleo: conversas → análise → decisão → alertas em disco. |
| `@diana/guardian-api` | API REST do responsável. Serve o alerta resumido. |
| `@diana/guardian-web` | Painel do responsável (React + Vite). |

O front importa os **mesmos tipos** que a API usa para montar a resposta — se o
contrato mudar, o `typecheck` quebra antes da tela.

## API

| Rota | O que faz |
|---|---|
| `GET /health` | Readiness: status, fonte ativa, uptime. |
| `GET /alerts` | Lista resumida. Filtros `priority`, `category`, `limit`, `cursor`. |
| `GET /alerts/:id` | Detalhe já resumido de um alerta. |
| `POST /alerts/:id/feedback` | `useful` · `false_positive` · `not_sure` (+ nota opcional). |
| `GET` · `PUT /settings` | Preferências do responsável. |

Erros são previsíveis: `400` entrada inválida, `404` alerta inexistente,
`503` fonte de alertas indisponível.

## Comandos

```bash
npm run demo    # analisa, sobe API + painel (o caminho feliz)
npm run seed    # só reprocessa as conversas e regrava os alertas
npm run check   # typecheck + testes de todos os pacotes
npm run build   # compila tudo, inclusive o front
npm run clean   # apaga dist/ e o estado da demo
```

## Trocando o mock pelo real

Tudo é mock **por padrão**; nada além disso é necessário para a demo. Os encaixes
para o mundo real já existem — ver `.env.example`:

| Quero… | Como |
|---|---|
| Análise por LLM na OCI | `ANALYZER=oci` + `OCI_COMPARTMENT_ID`, `OCI_MODEL_ID`, `OCI_REGION` |
| Ler alertas do Object Storage | `ALERTS_SOURCE=oci` + `OCI_OS_*` |
| Exigir chave na API | `GUARDIAN_API_KEY=algumacoisa` (header `x-api-key`) |

Escolher um backend ainda não implementado **falha no boot**, com a instrução do
que fazer — nunca silenciosamente, nem com um resultado inventado.

## Limites honestos desta demo

- **`ANALYZER=oci` e `ALERTS_SOURCE=oci` não estão implementados.** Existem como
  interface e falham explicitamente se selecionados.
- **A heurística é um baseline, não um classificador.** Casa expressões
  conhecidas; erra em ironia, gíria e contexto. Por isso todo alerta mostra os
  sinais que o justificaram — a decisão final é de um humano.
- **Não há autenticação.** Decisão consciente do MVP: a API é aberta (ou com uma
  chave simples). Não há identidade nem autorização por responsável.
- **O contato não é exibido no painel**, porque o payload de análise é
  identity-free. Mostrá-lo exige estendê-lo do mesmo jeito que o nome da criança.
- **O índice de nomes é lido no boot da API.** Rodou o `seed` de novo? Reinicie a
  API para ver os nomes atualizados.

## Ajuda a quem precisa agora

Se você chegou aqui por um caso real, e não pelo código: **Disque 100**
(violência contra crianças e adolescentes) e **CVV 188** (apoio emocional) são
gratuitos e funcionam 24h no Brasil.

# Provisionamento na OCI — São Paulo

Guia para deixar a DIANA rodando com os serviços da Oracle na região
**Brazil East (São Paulo)** — `sa-saopaulo-1`.

> **Por que São Paulo importa aqui.** A Generative AI não existe em todas as
> regiões da OCI, e São Paulo é a única da América do Sul que a oferece. Isso
> não é conveniência: significa que a conversa de uma criança brasileira é
> analisada **dentro do Brasil**, sem transferência internacional de dados
> pessoais de menores. Se o serviço não estivesse aqui, a alternativa seria
> mandar esse conteúdo para Chicago ou Frankfurt — uma decisão que mereceria
> discussão jurídica antes de técnica.

---

## O que vamos provisionar

| # | Serviço | Para quê | Custo |
|---|---|---|---|
| 1 | Compartimento | Isolar os recursos do projeto | grátis |
| 2 | Generative AI | Analisar as conversas | por token |
| 3 | Chaves de API | Rodar localmente | grátis |
| 4 | Autonomous Database | Guardar batches e alertas | **Always Free** disponível |
| 5 | Container Instance | Hospedar o backend (depois) | por hora |

---

## 1. Compartimento

**O que é:** uma pasta lógica que agrupa recursos. Não é um servidor nem custa
nada — é organização. Serve para três coisas que importam aqui: conceder
permissão a um conjunto de recursos de uma vez, enxergar o custo do projeto
separado do resto, e apagar tudo junto no fim do teste, sem caçar recurso
esquecido.

Toda tenancy já nasce com um compartimento **raiz**, que tem o nome da sua
conta. Vamos criar um filho chamado `diana`.

**O caminho:**

1. ☰ (menu, canto superior esquerdo) → **Identity & Security** → **Compartments**
2. **Create Compartment**
3. Preencha:
   - **Name**: `diana`
   - **Description**: Projeto DIANA — proteção digital infantil
   - **Parent Compartment**: deixe a **raiz** (o que tem o nome da sua tenancy)
4. **Create Compartment**

**Copie o OCID.** Clique no compartimento `diana` recém-criado; o **OCID**
aparece no topo da página, com um botão para copiar. É uma sequência longa:

```text
ocid1.compartment.oc1..aaaaaaaa…
```

Guarde num arquivo temporário — ele vira o `OCI_COMPARTMENT_ID` no `.env`, e
você vai precisar dele já no próximo passo.

> **OCID** é o identificador único de qualquer recurso na OCI. Você vai copiar
> vários ao longo deste guia; vale manter um bloco de notas aberto.

## ⚠️ Antes de começar: verifique o tipo da sua conta

**Isso decide metade do guia.** Confira em ☰ → **Billing & Cost Management** →
**Payment Method**.

| Serviço deste projeto | Free Tier / Promo | Pay As You Go |
|---|---|---|
| Compartimento | ✅ | ✅ |
| **Autonomous Database** | ✅ **Always Free** | ✅ |
| Container Instance | ✅ (dentro dos limites) | ✅ |
| **Generative AI** | ❌ **não incluído** | ✅ |

A Generative AI **não faz parte do Always Free**. Em conta *Free Tier* ou
*Promo*, mesmo com créditos disponíveis, o limite de requisições da tenancy é
baixo o bastante para o serviço ficar inutilizável na prática — e o erro que
aparece é `429: request is throttled for tenant`, que não menciona nada disso.

Contas trial também **não conseguem abrir pedido de aumento de limite**, que
seria a solução normal.

### Seus caminhos

**a) Seguir sem a nuvem, por enquanto** — recomendado para destravar agora

Use `ANALYZER=mock` (heurística local, já implementada) e faça os passos 1, 4 e
5 deste guia. O Autonomous Database é Always Free, então batches, persistência,
ingestão do Telegram e a tela do responsável funcionam por completo. Só a
análise por LLM fica de fora. Quando a conta virar paga, é trocar uma variável.

**b) Fazer upgrade para Pay As You Go**

Destrava a Generative AI. Os créditos promocionais costumam ser consumidos
antes da cobrança começar. Vale conferir o preço do modelo antes, e criar um
**Budget** com alerta (seção 7).

**c) Rodar o modelo localmente**

Não depende de conta paga nem de nuvem: um modelo pequeno roda na própria
máquina, e a conversa nunca sai dela. Foi implementado e revertido no commit
`2d9029e` — se fizer sentido retomar, é reaplicá-lo.

> Os passos 1, 4, 5, 6 e 7 valem para qualquer um dos caminhos. Apenas o
> passo 2 (e o `ANALYZER=oci` do passo 5) exigem conta paga.

---

## 2. Generative AI — passo a passo detalhado

Esta é a parte onde mais gente trava, e quase sempre pelo mesmo motivo:
**permissão**. Vale fazer com calma, porque ao final deste passo você terá a
certeza de que região, permissão e modelo funcionam — antes de escrever
qualquer linha de código.

### 2.0 Entrar no console

Acesse **[cloud.oracle.com](https://cloud.oracle.com)**.

A tela de login tem duas etapas, e a primeira confunde quem está começando:

1. **Cloud Account Name** — é o nome da sua *tenancy*, **não o seu e-mail**.
   Ele veio no e-mail de boas-vindas da Oracle. Se não lembrar, clique em
   *Forgot your cloud account name?* e informe o e-mail.
2. Depois, sim: usuário e senha.

### 2.1 Entendendo a tela

Três elementos que você vai usar o tempo todo:

| Onde | O quê |
|---|---|
| **☰** (canto superior esquerdo) | Menu de navegação com todos os serviços |
| **Barra de busca** (topo) | O jeito mais rápido de chegar em qualquer lugar — digite o nome do serviço |
| **Região** (canto superior direito) | Mostra a região ativa. **Preste atenção nisso.** |
| **👤** (canto superior direito) | Seu perfil, onde ficam as chaves de API |

> ⚠️ **A armadilha nº 1 da OCI:** quase tudo é **por região**. Se você criar um
> recurso em Ashburn e depois trocar para São Paulo, ele **some da tela** — não
> foi apagado, você só está olhando outra região. Antes de criar qualquer
> coisa, confirme a região no canto superior direito.

### 2.2 Trocar para São Paulo

1. Clique no **nome da região** (canto superior direito)
2. Procure **Brazil East (São Paulo)** e selecione

**Se São Paulo não aparecer na lista**, você ainda não assinou a região:

1. ☰ → **Governance & Administration** → **Region Management**
2. Encontre **Brazil East (São Paulo)** → **Subscribe**
3. Leva alguns minutos. Recarregue a página depois.

### 2.3 Descobrir a que grupo você pertence

Você precisa disso para escrever a política de permissão.

1. Clique no **👤** (canto superior direito) → **User settings** (ou *My profile*)
2. No menu à esquerda, em *Resources*, clique em **Groups**
3. Anote o nome que aparecer

Se você criou a conta Oracle, provavelmente está em **`Administrators`** —
use esse nome.

> Estar em `Administrators` **não dispensa** a política. Na OCI, o serviço de
> Generative AI exige uma autorização explícita.

### 2.4 Criar a política de permissão

**O conceito:** a OCI nega tudo por padrão. Uma *policy* é uma frase em inglês
que concede uma permissão específica. Sem ela, toda chamada volta
`NotAuthorizedOrNotFound` — e repare que a mensagem **não diz** que faltou
permissão; ela finge que o recurso não existe. É por isso que esse erro engana
tanta gente.

**Onde criar:** no compartimento **raiz** (o que tem o nome da sua tenancy).
Uma política criada dentro de um compartimento filho só vale ali dentro;
criando na raiz, você não se preocupa com isso agora.

**O caminho:**

1. ☰ → **Identity & Security** → **Policies**
2. No alto da lista, à esquerda, há um seletor **Compartment**.
   **Selecione o compartimento raiz** — é o que tem o nome da sua tenancy,
   geralmente o primeiro da lista, sem indentação.
3. **Create Policy**
4. Preencha:
   - **Name**: `diana-generative-ai`
   - **Description**: Permite ao projeto DIANA usar a Generative AI
   - **Compartment**: deve estar na **raiz**
5. Em *Policy Builder*, clique em **Show manual editor** (alterna para texto livre)
6. Cole, trocando `Administrators` pelo seu grupo se for diferente:

```text
Allow group Administrators to manage generative-ai-family in compartment diana
```

7. **Create**

**Anatomia da frase**, para você entender o que autorizou:

| Trecho | Significa |
|---|---|
| `Allow group Administrators` | quem: os usuários desse grupo |
| `to manage` | quanto: tudo (ler, usar, criar). Para só usar, seria `to use` |
| `generative-ai-family` | o quê: todos os recursos de Generative AI |
| `in compartment diana` | onde: apenas dentro do compartimento `diana` |

> Se você ainda não criou o compartimento `diana` (passo 1), crie agora — a
> política referencia um compartimento que precisa existir.

### 2.5 Testar no Playground — a validação que vale ouro

**Faça este teste antes de tocar no código.** Se o Playground responder, então
região, permissão e modelo estão corretos, e qualquer erro posterior é do
código — não da infraestrutura. Isso separa metade dos problemas possíveis.

1. ☰ → **Analytics & AI** → em *AI Services*, clique em **Generative AI**
2. No menu à esquerda, clique em **Playground**
3. Escolha **Chat** (não Embedding nem Rerank)
4. Confira o seletor de **Compartment** à esquerda: deve estar em `diana`
5. Em **Model**, escolha **Cohere Command A**
6. Na caixa de texto, cole algo parecido com o que a aplicação vai enviar:

```text
Responda apenas com JSON válido, sem markdown.
Analise a conversa e diga quais sinais de risco aparecem.

[M1] OUTRO: fica só entre a gente, nosso segredo
[M2] CRIANÇA: tá bom
[M3] OUTRO: manda uma foto sua

Formato: {"signals":[{"type":"secrecy_request|image_request","messageIds":["..."]}]}
```

7. Clique em **Submit**

**Deu certo se** apareceu uma resposta em JSON citando `secrecy_request` e
`image_request`. É exatamente isso que a aplicação fará, só que por API.

**Se deu erro:**

| Mensagem | O que houve |
|---|---|
| `NotAuthorizedOrNotFound` | A política do 2.4 não existe, está no compartimento errado, ou o nome do grupo está errado |
| O modelo não aparece na lista | Você não está em São Paulo — confira a região |
| `Compartment not found` | O seletor de compartimento está apontando para outro lugar |
| `429 ... throttled for tenant` | Limite de requisições da tenancy. Veja abaixo — **não é erro de permissão** |
| Erro de cota ou billing | Conta trial sem créditos válidos, ou créditos expirados |

#### Se aparecer `429: request is throttled for tenant`

Esse erro é, de certa forma, uma boa notícia: a requisição **foi autorizada** e
chegou ao serviço. Região e política estão corretas — o que faltou foi cota.

A Generative AI limita a taxa de requisições **por tenancy**, e contas novas
costumam vir com um limite baixo.

**O que fazer, em ordem:**

1. **Espere um minuto e tente de novo.** Se o limite for por janela de tempo,
   pode passar sozinho — é o teste mais barato.
2. **Confira o tipo da conta.** ☰ → **Billing & Cost Management** →
   **Payment Method**. Se aparecer *Free Tier* / *Trial*, a Generative AI pode
   estar limitada até o upgrade para pago. Ter créditos não é o mesmo que ter
   conta paga.
3. **Peça aumento de limite.** ☰ → **Governance & Administration** →
   **Limits, Quotas and Usage**:
   - **Service**: Generative AI
   - **Scope**: Brazil East (São Paulo)
   - Localize o limite de requisições e clique em **Request a service limit increase**
   - Descreva o uso: análise de texto por batch, com volume modesto

   > Contas trial normalmente **não podem** abrir pedido de aumento. Nesse caso,
   > o upgrade para pago é o caminho.

**Enquanto isso, o projeto não fica parado.** O backend já lida com 429:
repete a chamada com espaçamento crescente (`OCI_MAX_RETRIES`) e, se ainda
assim não passar, analisa pela heurística local — nenhuma conversa deixa de
ser avaliada. Para desenvolver sem depender da nuvem, use `ANALYZER=mock`.

### 2.6 Anotar o identificador do modelo

Ainda no Playground, com o modelo selecionado, procure o link **View model
details** (ou clique no nome do modelo). Ali aparece o **OCID**, algo como:

```text
ocid1.generativeaimodel.oc1.sa-saopaulo-1.amaaaaa…
```

Você pode usar **ou** o OCID **ou** o nome curto do modelo
(ex.: `cohere.command-a-03-2025`) no `OCI_MODEL_ID`. O nome curto é mais
legível; o OCID é mais preciso se houver várias versões.

> **Anote também o OCID do compartimento** (passo 1). Se perdeu:
> ☰ → **Identity & Security** → **Compartments** → clique em `diana` →
> o OCID aparece no topo, com um botão *Copy*.

### 2.7 Checklist antes de seguir

- [ ] Região no canto superior direito diz **Brazil East (São Paulo)**
- [ ] Compartimento `diana` criado, OCID copiado
- [ ] Política `diana-generative-ai` criada **na raiz**
- [ ] Playground respondeu com JSON
- [ ] Identificador do modelo anotado

Só depois de todos marcados vale ir para o passo 3.

---

## 3. Chaves de API (para rodar localmente)

> Em Container Instance isto **não é necessário** — lá a aplicação usa
> *instance principal* e não carrega credencial nenhuma.

**Console → canto superior direito (seu perfil) → User settings → API keys →
Add API key → Generate API key pair**

1. **Baixe a chave privada** (`.pem`). Ela não é mostrada de novo.
2. O console exibe um bloco de configuração. Guarde:
   - `user` → `OCI_USER_ID`
   - `fingerprint` → `OCI_FINGERPRINT`
   - `tenancy` → `OCI_TENANCY_ID`
   - `region` → `sa-saopaulo-1`

### Converter a chave para o `.env`

O `.env` não aceita quebra de linha, então a chave vai em uma linha só com `\n`:

```bash
awk 'BEGIN{ORS="\\n"} {print}' ~/Downloads/sua-chave.pem
```

Cole o resultado em `OCI_PRIVATE_KEY`.

> 🔒 A chave privada dá acesso à sua conta OCI. Ela fica só no `.env` local,
> que está no `.gitignore`. Nunca versione nem compartilhe.

---

## 4. Autonomous Database

### 4.1 Criar

**Console → Oracle Database → Autonomous Database → Create Autonomous Database**

- **Compartment**: `diana`
- **Display name**: `diana-db`
- **Database name**: `dianadb`
- **Workload type**: **Transaction Processing**
- **Deployment**: Serverless
- **Always Free**: ✅ **marque** — atende de sobra o volume do projeto e não gera custo
- **Password**: defina uma senha forte para o usuário `ADMIN`
- **Access**: *Secure access from everywhere* (para testar localmente)

### 4.2 Baixar o wallet

Depois de provisionado: **Database connection → Download wallet**

- Defina uma senha para o wallet (anote)
- Extraia o `.zip` numa pasta, ex.: `~/oracle/wallet_dianadb`

Dentro do `tnsnames.ora` estão os aliases de conexão:
`dianadb_high`, `dianadb_medium`, `dianadb_low`.
Use **`dianadb_low`** — é o de menor paralelismo, suficiente aqui.

### 4.3 Criar um usuário da aplicação

Conectar como `ADMIN` em produção é má prática. No **Database Actions → SQL**:

```sql
CREATE USER diana_app IDENTIFIED BY "TroqueEstaSenha#2026";
GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO diana_app;
ALTER USER diana_app QUOTA UNLIMITED ON DATA;
```

As tabelas (`diana_batches`, `diana_alerts`) são criadas pela aplicação na
primeira execução — não há script manual a rodar.

---

## 5. Configurar o `.env`

```ini
# --- análise na nuvem ---
ANALYZER=oci
OCI_COMPARTMENT_ID=ocid1.compartment.oc1..aaaa…
OCI_MODEL_ID=cohere.command-a-03-2025
OCI_REGION=sa-saopaulo-1
OCI_MODEL_FAMILY=cohere

# --- credenciais (só local; vazias em Container Instance) ---
OCI_TENANCY_ID=ocid1.tenancy.oc1..aaaa…
OCI_USER_ID=ocid1.user.oc1..aaaa…
OCI_FINGERPRINT=aa:bb:cc:…
OCI_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n

# --- banco ---
STORE=oracle
ORACLE_USER=diana_app
ORACLE_PASSWORD=TroqueEstaSenha#2026
ORACLE_CONNECT_STRING=dianadb_low
ORACLE_WALLET_DIR=/home/seu-usuario/oracle/wallet_dianadb
ORACLE_WALLET_PASSWORD=senha-do-wallet
```

Suba e observe o log:

```bash
npm run build && npm start
```

Esperado:

```text
Oracle: conectado e tabelas verificadas (diana_batches, diana_alerts).
DIANA backend em http://0.0.0.0:8080 (análise=oci:cohere.command-a-03-2025, batches=oracle, …)
```

---

## 6. Container Instance (quando for hospedar)

### 6.1 Sem credencial nenhuma

Em vez de copiar chaves para dentro do container, a instância se autentica
sozinha. **Deixe `OCI_TENANCY_ID`, `OCI_USER_ID`, `OCI_FINGERPRINT` e
`OCI_PRIVATE_KEY` vazios** — a aplicação detecta e usa *instance principal*.

Para isso funcionar, crie:

**Identity & Security → Dynamic Groups → Create**

- **Name**: `diana-instances`
- **Rule**: `ALL {resource.compartment.id = '<OCID do compartimento diana>'}`

**Identity & Security → Policies → Create** (raiz):

```text
Allow dynamic-group diana-instances to use generative-ai-family in compartment diana
```

### 6.2 Publicar a imagem

```bash
docker build -t sa-saopaulo-1.ocir.io/<namespace>/diana-backend:1 .
docker login sa-saopaulo-1.ocir.io      # usuário: <namespace>/<seu-email>
docker push sa-saopaulo-1.ocir.io/<namespace>/diana-backend:1
```

> O `namespace` está em **Tenancy details → Object storage namespace**.
> A senha do `docker login` é um **Auth Token** (User settings → Auth tokens),
> não a senha da conta.

O wallet do banco precisa ir junto: ou embutido na imagem, ou montado.

---

## 7. Custo — o que vigiar

O sistema analisa a cada 10 segundos **quando há mensagem nova**. Conversa
parada não gera chamada nem custo. Ainda assim, vale ter noção:

| Item | Ordem de grandeza |
|---|---|
| Prompt de sistema | ~700 tokens por chamada |
| Janela de conversa | ~300–800 tokens |
| Resposta | ~50–200 tokens |

Uma conversa ativa que dispare 6 batches por minuto consome na casa de
**6 a 10 mil tokens por minuto**. Multiplique pelo preço do modelo escolhido.

**Controles que já existem no código:**

- `BATCH_INTERVAL_MS` — aumentar para 30s ou 60s corta chamadas
  proporcionalmente
- `CONTEXT_BATCHES` — menos batches na janela, prompt menor
- `ANALYZER=mock` — desliga a nuvem por completo, sem mudar mais nada

**Controle na OCI:** crie um **Budget** (Billing → Budgets) no compartimento
`diana` com alerta por e-mail. É a rede de segurança contra surpresa.

---

## Se der errado

| Erro | Causa |
|---|---|
| `NotAuthorizedOrNotFound` | Policy ausente ou compartimento errado |
| `404` no modelo | Modelo não disponível em São Paulo, ou OCID errado |
| `ORA-12506` / timeout | Wallet ausente ou `ORACLE_WALLET_DIR` incorreto |
| `ORA-01017` | Usuário ou senha do banco errados |
| `DPI-1047` | Não deve ocorrer: usamos modo *thin*, sem Instant Client |
| Análise cai para a heurística | Veja o log — o motivo real vem junto |

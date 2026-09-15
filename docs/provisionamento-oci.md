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

Um compartimento separa os recursos do projeto do resto da tenancy — facilita
controlar permissão e enxergar custo depois.

**Console → Identity & Security → Compartments → Create Compartment**

- **Name**: `diana`
- **Description**: Projeto DIANA — proteção digital infantil
- **Parent**: a raiz da tenancy

Copie o **OCID** do compartimento (`ocid1.compartment.oc1..aaaa…`).
Ele vira o `OCI_COMPARTMENT_ID`.

---

## 2. Generative AI

### 2.1 Confirme a região

No canto superior direito do console, selecione **Brazil East (São Paulo)**.
Se ela não aparecer, vá em **Governance & Administration → Region Management**
e assine a região.

### 2.2 Dê permissão (o passo que mais trava)

Sem policy, toda chamada volta `NotAuthorizedOrNotFound` — e a mensagem não
diz que o problema é permissão.

**Console → Identity & Security → Policies → Create Policy** (no compartimento
raiz), modo **Show manual editor**:

```
Allow group <SEU_GRUPO> to manage generative-ai-family in compartment diana
```

Se você é administrador da tenancy, seu usuário já está em `Administrators` —
use esse nome no lugar de `<SEU_GRUPO>`.

### 2.3 Veja os modelos disponíveis

**Console → Analytics & AI → Generative AI → Playground**

Teste um prompt ali antes de escrever qualquer código: se o Playground
responde, a região e a policy estão corretas.

Copie o **OCID do modelo** escolhido (ou use o nome, ex.: `cohere.command-a-03-2025`).
Ele vira o `OCI_MODEL_ID`.

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

```
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

```
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

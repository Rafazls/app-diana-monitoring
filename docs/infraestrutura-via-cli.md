# Infraestrutura da OCI via CLI

Todo o provisionamento da DIANA — compartimento, rede, instâncias e banco de
dados — executado pelo terminal, na região **Brazil East (São Paulo)**
(`sa-saopaulo-1`).

O guia [`provisionamento-oci.md`](provisionamento-oci.md) faz o mesmo caminho
clicando no console. Os dois documentos não competem: o console ensina, porque
mostra os campos com nome e ajuda ao lado; a CLI **repete**. Depois que você
entendeu o que cada recurso é, a CLI é o que permite derrubar tudo no fim do
mês e recriar igual na semana seguinte, sem redescobrir qual checkbox estava
marcado.

> **Sobre as fontes.** Os comandos abaixo foram conferidos na [referência
> oficial da OCI CLI](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/).
> O artigo do Medium que você indicou responde **403** para acesso automatizado,
> então nada aqui foi copiado dele — se ele divergir em algum ponto, a
> referência oficial é a que vale, porque acompanha a versão da CLI que você
> acabou de instalar.

---

## Índice

| # | Etapa | O que sai dela |
|---|---|---|
| 0 | [Instalar e autenticar a CLI](#0-instalar-e-autenticar-a-cli) | `~/.oci/config` funcionando |
| 1 | [Compartimento](#1-compartimento) | `COMPARTMENT_OCID` |
| 2 | [Rede: VCN, gateway, rota, sub-rede](#2-rede) | `SUBNET_OCID` |
| 3 | [Network Security Group e regras](#3-network-security-group) | `NSG_OCID` |
| 4 | [Instância de computação](#4-instância-de-computação) | IP público da VM |
| 5 | [Autonomous Database](#5-autonomous-database) | credenciais + wallet |
| 6 | [Ligar na aplicação](#6-ligar-na-aplicação) | `.env` preenchido |
| 7 | [Conferir e derrubar tudo](#7-conferir-e-derrubar-tudo) | tenancy limpa |

---

## 0. Instalar e autenticar a CLI

### 0.1 Instalar

**Linux / macOS:**

```bash
bash -c "$(curl -L https://raw.githubusercontent.com/oracle/oci-cli/master/scripts/install/install.sh)"
```

O instalador pergunta onde colocar os binários e se pode mexer no seu `PATH`.
Aceitar os padrões está bom. Abra um terminal novo depois — o `PATH` só vale
para shells iniciados após a mudança.

**Windows (PowerShell):** o mesmo script existe em `install.ps1`, ou use
`winget install Oracle.OCICLI`.

Confirme:

```bash
oci --version
```

### 0.2 Autenticar

```bash
oci setup config
```

Ele faz cinco perguntas e você precisa de duas informações que só existem no
console:

| Pergunta | Onde achar |
|---|---|
| **User OCID** | console → ícone de perfil → *My profile* → copiar OCID |
| **Tenancy OCID** | console → ícone de perfil → *Tenancy* → copiar OCID |
| **Region** | digite `sa-saopaulo-1` |
| Gerar par de chaves? | responda **Y** |
| Passphrase | deixe vazio (a aplicação não teria como digitá-la) |

No fim ele grava `~/.oci/config` e um par de chaves em `~/.oci/`. A chave
**privada** (`oci_api_key.pem`) é o que autentica você: ela vale como sua
senha, nunca entra em repositório nem em chat.

A pública ainda precisa ser registrada na sua conta:

```bash
oci iam user api-key upload \
  --user-id "<seu-user-ocid>" \
  --key-file ~/.oci/oci_api_key_public.pem
```

> Esse comando é ovo-e-galinha: ele já precisa de uma chave válida para rodar.
> Na primeira vez, faça o upload pelo console — *My profile* → *API keys* →
> *Add API key* → *Paste public key* — colando o conteúdo de
> `~/.oci/oci_api_key_public.pem`. Da segunda chave em diante, o comando acima
> funciona.

### 0.3 Testar

```bash
oci iam region list --output table
```

Se listar as regiões, a autenticação está de pé. Se der `NotAuthenticated`,
a chave pública não foi registrada ou o `fingerprint` no `~/.oci/config` não
corresponde à que você subiu.

### 0.4 Um arquivo para os OCIDs

Cada recurso criado devolve um OCID que o próximo comando consome. Em vez de
copiar e colar entre terminais, guarde num arquivo e recarregue quando precisar:

```bash
cat > ~/.oci/diana-env.sh <<'EOF'
export OCI_REGION="sa-saopaulo-1"
export TENANCY_OCID="ocid1.tenancy.oc1..xxxxx"
EOF

chmod 600 ~/.oci/diana-env.sh
source ~/.oci/diana-env.sh
```

O `TENANCY_OCID` você lê do próprio config:

```bash
grep '^tenancy' ~/.oci/config
```

Esse arquivo mora em `~/.oci/`, fora do repositório, de propósito. Nenhum OCID
é segredo grave, mas o hábito de deixar identificador de infraestrutura fora do
Git é o mesmo que impede a chave privada de vazar junto um dia.

### 0.5 Duas opções que valem em quase todo comando

```bash
--query 'data.id' --raw-output   # imprime só o OCID, sem JSON nem aspas
--wait-for-state AVAILABLE       # segura o terminal até o recurso ficar pronto
```

Sem `--wait-for-state`, a CLI devolve na hora com o recurso em
`PROVISIONING`, e o comando seguinte falha porque o OCID ainda não serve.
Todos os exemplos abaixo já usam as duas.

---

## 1. Compartimento

Uma pasta lógica: não é servidor, não custa nada, e é o que permite apagar o
projeto inteiro no fim sem caçar recurso esquecido.

```bash
source ~/.oci/diana-env.sh

export COMPARTMENT_OCID=$(oci iam compartment create \
  --compartment-id "$TENANCY_OCID" \
  --name "diana" \
  --description "Recursos da plataforma DIANA" \
  --wait-for-state ACTIVE \
  --query 'data.id' --raw-output)

echo "export COMPARTMENT_OCID=\"$COMPARTMENT_OCID\"" >> ~/.oci/diana-env.sh
echo "$COMPARTMENT_OCID"
```

`--compartment-id` aqui é o **pai**, não o que está sendo criado. Passando a
tenancy, o `diana` nasce na raiz.

Criação de compartimento demora alguns segundos a propagar mesmo depois de
`ACTIVE`. Se o comando seguinte reclamar que o compartimento não existe, espere
meio minuto e repita.

Para conferir:

```bash
oci iam compartment list --compartment-id "$TENANCY_OCID" --output table \
  --query 'data[].{nome:name,estado:"lifecycle-state",id:id}'
```

> **Detalhe da CLI:** na saída JSON, os campos vêm em *kebab-case*
> (`lifecycle-state`, `default-route-table-id`), não no camelCase da API. Isso
> importa na hora de escrever `--query`.

---

## 2. Rede

Quatro recursos, nesta ordem, porque cada um depende do anterior:

```
VCN (10.0.0.0/16)
 ├── Internet Gateway          porta para a internet
 ├── Route Table (a default)   0.0.0.0/0 → gateway
 └── Subnet (10.0.1.0/24)      onde a VM ganha IP
```

### 2.1 VCN

```bash
export VCN_OCID=$(oci network vcn create \
  --compartment-id "$COMPARTMENT_OCID" \
  --cidr-blocks '["10.0.0.0/16"]' \
  --display-name "diana-vcn" \
  --dns-label "diana" \
  --wait-for-state AVAILABLE \
  --query 'data.id' --raw-output)

echo "export VCN_OCID=\"$VCN_OCID\"" >> ~/.oci/diana-env.sh
```

A VCN já nasce com **route table padrão, security list padrão e DHCP options
padrão** — não precisa criar nenhum dos três. Pegue o OCID da route table
padrão, porque é nela que a rota de saída vai entrar:

```bash
export RT_OCID=$(oci network vcn get --vcn-id "$VCN_OCID" \
  --query 'data."default-route-table-id"' --raw-output)
```

`10.0.0.0/16` é espaço privado: 65 mil endereços que só existem dentro da sua
VCN. Escolher um bloco grande agora não custa nada e evita colisão se um dia
essa rede precisar conversar com outra.

### 2.2 Internet Gateway

```bash
export IGW_OCID=$(oci network internet-gateway create \
  --compartment-id "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" \
  --is-enabled true \
  --display-name "diana-igw" \
  --wait-for-state AVAILABLE \
  --query 'data.id' --raw-output)
```

Sem ele a VM sobe, recebe IP público e mesmo assim não alcança nada — nem
`apt update`. O gateway existe, mas ninguém o usa até haver uma rota.

### 2.3 Rota de saída

```bash
oci network route-table update \
  --rt-id "$RT_OCID" \
  --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW_OCID\"}]" \
  --force
```

> **Cuidado:** `--route-rules` **substitui o conjunto inteiro** de regras, não
> acrescenta. Se a tabela já tivesse rotas, você teria que reenviar todas. Aqui
> a tabela está vazia, então a substituição é inofensiva.

`--force` pula a confirmação interativa. `cidrBlock` e `networkEntityId` vão em
camelCase aqui — é JSON de entrada da API, não saída formatada da CLI.

### 2.4 Sub-rede

```bash
export SUBNET_OCID=$(oci network subnet create \
  --compartment-id "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" \
  --cidr-block "10.0.1.0/24" \
  --display-name "diana-subnet-publica" \
  --dns-label "publica" \
  --route-table-id "$RT_OCID" \
  --prohibit-public-ip-on-vnic false \
  --wait-for-state AVAILABLE \
  --query 'data.id' --raw-output)

echo "export SUBNET_OCID=\"$SUBNET_OCID\"" >> ~/.oci/diana-env.sh
```

`--prohibit-public-ip-on-vnic false` é o que torna a sub-rede **pública**. Com
`true`, nenhuma VM dela consegue IP público — e o `--assign-public-ip true` do
passo 4 falharia sem explicação óbvia.

Sub-rede em São Paulo é **regional** por padrão: cobre todos os availability
domains, e você não precisa escolher um.

---

## 3. Network Security Group

O NSG é o firewall que fica na frente da VM. Um NSG vazio bloqueia tudo o que
entra — as regras abaixo abrem só o necessário.

```bash
export NSG_OCID=$(oci network nsg create \
  --compartment-id "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" \
  --display-name "diana-nsg" \
  --wait-for-state AVAILABLE \
  --query 'data.id' --raw-output)

echo "export NSG_OCID=\"$NSG_OCID\"" >> ~/.oci/diana-env.sh
```

### 3.1 Descobrir seu IP

As duas regras de entrada são restritas ao **seu** IP. Descubra qual é:

```bash
export MEU_IP=$(curl -s https://checkip.amazonaws.com)
echo "$MEU_IP"
```

### 3.2 SSH (porta 22)

```bash
oci network nsg rules add \
  --nsg-id "$NSG_OCID" \
  --security-rules "[{
    \"direction\": \"INGRESS\",
    \"protocol\": \"6\",
    \"source\": \"$MEU_IP/32\",
    \"sourceType\": \"CIDR_BLOCK\",
    \"isStateless\": false,
    \"description\": \"SSH a partir da maquina do desenvolvedor\",
    \"tcpOptions\": { \"destinationPortRange\": { \"min\": 22, \"max\": 22 } }
  }]"
```

`protocol` é o número IANA: `6` = TCP, `17` = UDP, `1` = ICMP, `all` = qualquer.

### 3.3 Servidor de modelo (porta 8000)

```bash
oci network nsg rules add \
  --nsg-id "$NSG_OCID" \
  --security-rules "[{
    \"direction\": \"INGRESS\",
    \"protocol\": \"6\",
    \"source\": \"$MEU_IP/32\",
    \"sourceType\": \"CIDR_BLOCK\",
    \"isStateless\": false,
    \"description\": \"API do modelo, apenas para o dev\",
    \"tcpOptions\": { \"destinationPortRange\": { \"min\": 8000, \"max\": 8000 } }
  }]"
```

> **Nunca `0.0.0.0/0` na porta 8000.** Esse endpoint não tem autenticação: quem
> chegar nele usa sua GPU/CPU de graça e, pior, manda texto arbitrário para um
> modelo que existe para analisar conversa de criança. Scanners acham porta
> aberta em minutos, não em dias. Se o seu IP mudar (rede doméstica dinâmica,
> outro café), o certo é **atualizar a regra**, não abrir para o mundo:
>
> ```bash
> oci network nsg rules list --nsg-id "$NSG_OCID" --output table \
>   --query 'data[].{id:id,porta:"tcp-options".*,origem:source}'
> # pegue o id da regra e:
> oci network nsg rules update --nsg-id "$NSG_OCID" --security-rules '[{"id":"<id>", ...}]'
> ```

### 3.4 Saída liberada

```bash
oci network nsg rules add \
  --nsg-id "$NSG_OCID" \
  --security-rules '[{
    "direction": "EGRESS",
    "protocol": "all",
    "destination": "0.0.0.0/0",
    "destinationType": "CIDR_BLOCK",
    "isStateless": false,
    "description": "Saida liberada: apt, download de modelo, API do Telegram"
  }]'
```

Aqui `0.0.0.0/0` é apropriado: é a VM **iniciando** conexões (baixar pacote,
falar com o Telegram), não o mundo iniciando conexão com ela.

Conferir tudo:

```bash
oci network nsg rules list --nsg-id "$NSG_OCID" --output table \
  --query 'data[].{direcao:direction,proto:protocol,origem:source,destino:destination,desc:description}'
```

---

## 4. Instância de computação

### 4.1 Availability domain

```bash
oci iam availability-domain list --compartment-id "$COMPARTMENT_OCID" --output table

export AD_NAME=$(oci iam availability-domain list \
  --compartment-id "$COMPARTMENT_OCID" \
  --query 'data[0].name' --raw-output)
```

São Paulo tem um único AD, então `[0]` resolve. O nome vem com um prefixo
aleatório da tenancy, tipo `abCd:SA-SAOPAULO-1-AD-1` — por isso se consulta em
vez de digitar.

### 4.2 Imagem do sistema

A VM é **ARM** (Ampere). Imagem de x86 não sobe nela, e o erro não diz isso com
todas as letras. Filtre pela shape:

> **A1 ou A2?** A `VM.Standard.A1.Flex` é a shape do Always Free — e por ser
> gratuita, é a mais disputada: em São Paulo ela responde `Out of host capacity`
> por dias seguidos. A `VM.Standard.A2.Flex` é a geração seguinte, **paga**, e
> por isso tem capacidade real. As duas rodam a **mesma imagem `aarch64`**, e
> trocar entre elas é mudar só o `--shape`. Os comandos abaixo usam A2; para
> tentar a gratuita, troque `A2` por `A1` em todos eles.

```bash
oci compute image list \
  --compartment-id "$COMPARTMENT_OCID" \
  --operating-system "Canonical Ubuntu" \
  --operating-system-version "22.04" \
  --shape "VM.Standard.A2.Flex" \
  --sort-by TIMECREATED --sort-order DESC \
  --output table --query 'data[0:5].{nome:"display-name",id:id}'

export IMAGE_OCID=$(oci compute image list \
  --compartment-id "$COMPARTMENT_OCID" \
  --operating-system "Canonical Ubuntu" \
  --operating-system-version "22.04" \
  --shape "VM.Standard.A2.Flex" \
  --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)
```

O nome da imagem correta contém `aarch64`. Se vier sem, o filtro `--shape` não
foi aplicado.

### 4.3 Chave SSH

```bash
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "diana-oci"
```

A chave **pública** vai para a VM; a privada fica na sua máquina e nunca sai
dela. Se você perder a privada, não existe "recuperar senha": a VM vira
inacessível e o caminho é recriar.

### 4.4 Subir a VM

```bash
export INSTANCE_OCID=$(oci compute instance launch \
  --availability-domain "$AD_NAME" \
  --compartment-id "$COMPARTMENT_OCID" \
  --subnet-id "$SUBNET_OCID" \
  --nsg-ids "[\"$NSG_OCID\"]" \
  --shape "VM.Standard.A2.Flex" \
  --shape-config '{"ocpus": 2, "memory_in_gbs": 12}' \
  --image-id "$IMAGE_OCID" \
  --boot-volume-size-in-gbs 100 \
  --assign-public-ip true \
  --ssh-authorized-keys-file ~/.ssh/id_ed25519.pub \
  --display-name "diana-modelo" \
  --vnic-display-name "diana-modelo-vnic" \
  --wait-for-state RUNNING \
  --query 'data.id' --raw-output)

echo "export INSTANCE_OCID=\"$INSTANCE_OCID\"" >> ~/.oci/diana-env.sh
```

Os três obrigatórios são `--availability-domain`, `--compartment-id` e
`--subnet-id`; o resto é o que faz a VM ser útil:

| Opção | Por que assim |
|---|---|
| `--shape VM.Standard.A2.Flex` | ARM Ampere, geração com capacidade disponível |
| `--shape-config '{"ocpus": 2, "memory_in_gbs": 12}'` | o A2 aceita 1–78 OCPU e até 64 GB por OCPU; 2/12 serve um modelo 3B–7B quantizado |
| `--boot-volume-size-in-gbs 100` | 50 GB não caberia modelo + cache do sistema |
| `--assign-public-ip true` | sem isso não há SSH de fora |
| `--nsg-ids` | aplica o firewall do passo 3 |

> ⚠️ **O A2 é cobrado por hora, enquanto a instância existir** — parada ou não,
> o boot volume continua contando. Isso é diferente do A1 dentro da cota
> gratuita. Se a VM é para uma demonstração com data marcada, crie perto da
> data e **termine depois** (passo 7.3). Vale criar um alerta de orçamento
> antes, não depois.

**Se ainda quiser tentar a gratuita:** troque `A2` por `A1` e repita o comando —
a imagem é a mesma. O erro esperado é:

> **`Out of host capacity`**, que não é erro seu: é falta de máquina ARM livre
> na região naquele instante. Em São Paulo o A1 fica assim por dias. Repetir o
> comando adiante pode resolver; mudar parâmetro não resolve. Foi exatamente
> essa parede que motivou o A2 como padrão aqui.

### 4.5 Redimensionar a VM depois

A shape é *flex*: dá para mudar OCPU e memória sem recriar a instância, sem
perder o disco e sem reinstalar nada.

```bash
source ~/.oci/diana-env.sh

oci compute instance update \
  --instance-id "$INSTANCE_OCID" \
  --shape-config '{"ocpus": 4, "memory_in_gbs": 48}' \
  --force
```

**A instância reinicia sozinha** ao aplicar — não precisa parar antes, mas a
conexão cai e o serviço fica fora do ar por um ou dois minutos. Com
`--restart unless-stopped` no container, o modelo volta sem intervenção.

Limites do `VM.Standard.A2.Flex`: 1 a 78 OCPUs, 1 a 64 GB de memória **por
OCPU**. Consulte antes de pedir um valor que a shape não aceita:

```bash
oci compute shape list -c "$COMPARTMENT_OCID" \
  --availability-domain "$AD_NAME" --all \
  --query 'data[?shape==`VM.Standard.A2.Flex`] | [0]."ocpu-options"'
```

Confirme o que ficou valendo:

```bash
oci compute instance get --instance-id "$INSTANCE_OCID" \
  --query 'data."shape-config"' --output table
```

#### Quanto adianta, na prática

Medições deste projeto, mesmo modelo (Qwen2.5-3B Q4_K_M) e mesmo prompt:

| Máquina | Latência por análise | tok/s |
|---|---|---|
| i5-1135G7, 4 núcleos, **AVX512-VNNI** | **~11s** | 11,3 |
| A2.Flex, 2 OCPU (ARM) | 35–59s | 2,3–3,8 |

A diferença não é o número de núcleos — é a instrução vetorial. O AVX512-VNNI
faz multiplicação de inteiros de 8 bits em hardware, que é exatamente a
operação de um modelo quantizado. O Ampere não tem equivalente, então dobrar
OCPUs dobra a velocidade na melhor das hipóteses, enquanto o x86 já começa
várias vezes à frente.

Consequência para o dimensionamento: **não escolha o tamanho pela RAM.** O
modelo de 3B ocupa menos de 3 GB; a memória sobra em qualquer configuração. Quem
manda no tempo de resposta é OCPU, e mesmo assim com retorno decrescente.

> **Custo sobe junto e na hora.** O A2 é cobrado por OCPU/hora: dobrar OCPUs
> dobra a conta. Se o objetivo é uma demonstração com data marcada, é mais
> barato aumentar um dia antes e voltar a reduzir depois — o comando é o mesmo,
> com o número menor.

Se depois de aumentar a análise ainda não couber no `BATCH_INTERVAL_MS`, o
ajuste honesto é aumentar o intervalo (veja `.env` no passo 6) em vez de
continuar comprando OCPU: um alerta 60s mais lento é melhor que uma fila que
nunca esvazia.

---

### 4.6 IP público e primeiro acesso

```bash
export VM_IP=$(oci compute instance list-vnics --instance-id "$INSTANCE_OCID" \
  --query 'data[0]."public-ip"' --raw-output)

echo "export VM_IP=\"$VM_IP\"" >> ~/.oci/diana-env.sh
ssh ubuntu@"$VM_IP"
```

O usuário é `ubuntu` nas imagens Canonical e `opc` nas Oracle Linux. Login como
`root` é bloqueado por padrão — isso é intencional, use `sudo`.

### 4.7 O firewall de dentro

A VM tem um **segundo** firewall, no sistema operacional, independente do NSG.
Abrir a porta na OCI e esquecer deste é o motivo nº 1 de "a porta está aberta e
não conecta":

```bash
# dentro da VM
# A posição importa: a cadeia INPUT do Ubuntu na OCI termina com um
# `REJECT all`, e qualquer ACCEPT depois dele é inerte — a porta continua
# fechada, sem mensagem de erro nenhuma. Descubra onde o REJECT está em vez
# de chutar um número.
POS=$(sudo iptables -L INPUT -n --line-numbers | awk '/REJECT/ {print $1; exit}')
sudo iptables -I INPUT "${POS:-1}" -m state --state NEW -p tcp --dport 8000 -j ACCEPT
sudo netfilter-persistent save

# Confira que a regra ficou ANTES do REJECT:
sudo iptables -L INPUT -n --line-numbers | head -10
```

---

## 5. Autonomous Database

O banco onde os batches e alertas são persistidos. A versão **Always Free** tem
1 OCPU e 20 GB, e é suficiente para o volume deste projeto.

```bash
export ADB_OCID=$(oci db autonomous-database create \
  --compartment-id "$COMPARTMENT_OCID" \
  --db-name "dianadb" \
  --display-name "diana-adb" \
  --db-workload OLTP \
  --is-free-tier true \
  --admin-password "$ADB_ADMIN_PASSWORD" \
  --wait-for-state AVAILABLE \
  --query 'data.id' --raw-output)

echo "export ADB_OCID=\"$ADB_OCID\"" >> ~/.oci/diana-env.sh
```

Antes de rodar, defina a senha **sem deixá-la no histórico do shell** — um
espaço no início da linha basta na maioria das configurações de bash (`HISTCONTROL=ignorespace`),
ou leia do teclado:

```bash
read -rsp "Senha do ADMIN do ADB: " ADB_ADMIN_PASSWORD; export ADB_ADMIN_PASSWORD; echo
```

Regras da senha, que o erro da API não explica bem:

- 12 a 30 caracteres;
- pelo menos uma maiúscula, uma minúscula e um número;
- **não** pode conter aspas duplas (`"`);
- **não** pode conter a palavra `admin`, em qualquer caixa.

E do `--db-name`: 1 a 30 caracteres alfanuméricos, começando por letra, sem
hífen ou underscore, **único na tenancy inteira** — se `dianadb` já existir em
outro compartimento seu, a criação falha.

> `--cpu-core-count` e `--data-storage-size-in-tbs` **não se aplicam** ao
> Always Free: os recursos são fixos em 1 OCPU e 20 GB. Passar essas opções
> junto de `--is-free-tier true` causa erro.

### 5.1 Wallet

A conexão ao ADB é mTLS: o cliente precisa da wallet.

```bash
read -rsp "Senha da wallet (>= 8 chars): " WALLET_PASSWORD; echo

mkdir -p ~/.oci/diana-wallet

oci db autonomous-database generate-wallet \
  --autonomous-database-id "$ADB_OCID" \
  --password "$WALLET_PASSWORD" \
  --file ~/.oci/diana-wallet/wallet.zip

unzip -o ~/.oci/diana-wallet/wallet.zip -d ~/.oci/diana-wallet/
```

A senha da wallet é **outra**, independente da senha do ADMIN.

A wallet é credencial de acesso ao banco onde ficam os dados de conversas de
crianças. Ela mora em `~/.oci/`, fora do repositório, e não é anexada em
mensagem nem em issue. O `.gitignore` do projeto já cobre `.env`, mas não
adianta nada se a wallet for commitada ao lado.

### 5.2 Serviços de conexão

```bash
grep -o '^[a-z0-9_]*' ~/.oci/diana-wallet/tnsnames.ora | sort -u
```

Saem cinco nomes (`dianadb_high`, `_medium`, `_low`, `_tp`, `_tpurgent`).
Para esta aplicação, **`_tp`** é o adequado: transacional, muitas conexões
curtas. `_high` é o oposto — prioriza uma consulta analítica longa sobre
concorrência.

---

## 6. Ligar na aplicação

Com tudo provisionado, resta preencher o `.env` do backend — que o `.gitignore`
já protege, e que é o único lugar onde as credenciais devem existir.

### 6.1 A armadilha que custa uma sessão de depuração

**O `.env` não expande variável de shell.** Quem lê esse arquivo é o Node, não o
bash. Estas duas linhas estão erradas:

```bash
MODEL_SERVER_URL=http://$VM_IP:8000/v1        # vira a string com o cifrão
ORACLE_WALLET_DIR=$HOME/.oci/diana-wallet     # idem
```

O que torna isso pior que um erro comum: o `ServerRiskAnalyzer` tem
`fallback: MockRiskAnalyzer`. Com a URL inválida, a aplicação **não quebra** —
ela cai calada na heurística local, continua gerando alertas, e você passa a
avaliar um modelo que nunca foi consultado.

Escreva os valores por extenso. Para conferir o que a aplicação realmente lê:

```bash
node --env-file-if-exists=.env \
  -e 'console.log(process.env.MODEL_SERVER_URL, process.env.ORACLE_WALLET_DIR)'
```

Se aparecer um `$` na saída, não está resolvido.

### 6.2 Como fica o arquivo

Os valores abaixo são exemplos — troque o IP, as senhas e o nome do modelo
pelos seus.

```bash
# ---------------------------------------------------------------------------
# Ingestão
# ---------------------------------------------------------------------------
# fixtures = conversas de exemplo (sobe sem bot e sem token)
# telegram = bot real via long polling
INGESTION=telegram

# Token do @BotFather. Desligue o modo privacidade (/setprivacy → Disable),
# senão o bot só recebe mensagens que o mencionam e o grupo passa em branco.
TELEGRAM_BOT_TOKEN=123456:AAE...
# Id numérico da conta da criança. É o que separa "child" de "other" — sem
# ele, sinais que só contam vindos do interlocutor deixam de ser detectados.
TELEGRAM_CHILD_ID=987654321
CHILD_NAME=Rafael
# Vazio = Telegram real. Aponte para tools/telegram-sim.mjs para testar sem bot.
TELEGRAM_API_BASE=

# ---------------------------------------------------------------------------
# Cadência
# ---------------------------------------------------------------------------
# Regule pela velocidade do analisador: se a análise demora mais que o
# intervalo, a fila cresce mais rápido do que esvazia.
#   modelo em x86 com AVX512 ... 10000
#   modelo em ARM (A1/A2) ...... 60000
BATCH_INTERVAL_MS=10000
CONTEXT_BATCHES=3

# ---------------------------------------------------------------------------
# Análise
# ---------------------------------------------------------------------------
# mock   = heurística determinística, sem custo e sem credencial
# server = modelo próprio (esta VM, sua máquina, qualquer API compatível)
# oci    = OCI Generative AI (exige conta paga; Free Tier responde 429)
ANALYZER=server

# IP POR EXTENSO — ver 6.1.
#   modelo na VM ............... http://163.176.70.177:8000/v1
#   modelo na própria máquina .. http://127.0.0.1:8000/v1
MODEL_SERVER_URL=http://163.176.70.177:8000/v1
# Exatamente o `id` que o servidor publica:
#   curl -s http://163.176.70.177:8000/v1/models
MODEL_SERVER_MODEL=qwen2.5-3b
MODEL_SERVER_API_KEY=
# Em ARM uma análise passa de 1 minuto; cortar no meio vira conversa não
# analisada, então o teto precisa de folga.
MODEL_SERVER_TIMEOUT_MS=120000
MODEL_SERVER_MAX_RETRIES=3
MODEL_SERVER_JSON_MODE=true

# ---------------------------------------------------------------------------
# Persistência
# ---------------------------------------------------------------------------
# memory = some no reinício (ótimo para demo)
# file   = grava em STATE_DIR
# oracle = Autonomous Database; tabelas criadas na 1ª execução
STORE=oracle
STATE_DIR=./.state

ORACLE_USER=ADMIN
ORACLE_PASSWORD=<senha-do-admin-do-adb>
# Alias do tnsnames. `_tp` é transacional (muitas conexões curtas), que é o
# perfil desta aplicação; `_high` prioriza consulta longa e é o oposto disso.
ORACLE_CONNECT_STRING=dianadb_tp
# Caminho absoluto, sem $HOME — ver 6.1.
ORACLE_WALLET_DIR=/home/SEU_USUARIO/.oci/diana-wallet
ORACLE_WALLET_PASSWORD=<senha-da-wallet>

# ---------------------------------------------------------------------------
# API HTTP
# ---------------------------------------------------------------------------
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
CORS_ORIGINS=*
# Vazio = API aberta (só para demo local). Definido = exige header x-api-key.
# Não é controle de acesso real: não há identidade por responsável.
GUARDIAN_API_KEY=
```

Há um `.env.example` completo e comentado na raiz do repositório — ele é a
referência canônica, e este trecho é um recorte dele.

### 6.3 Conferir que está tudo ligado

```bash
npm run build && npm start
```

O boot imprime o que foi realmente carregado:

```
DIANA backend em http://0.0.0.0:8080
(ingestão=telegram, análise=server:qwen2.5-3b, batches=oracle, alertas=oracle)
Batches a cada 10s, analisando as últimas 3 janelas de contexto.
Telegram conectado como @seu_bot. Aguardando mensagens…
```

Se `análise=` aparecer como `mock` quando você configurou `server`, é o
fallback silencioso do 6.1 — confira a URL antes de investigar outra coisa.

Como subir o servidor de modelo dentro da VM — qual modelo escolher, como
servi-lo em `/v1/chat/completions` e como treiná-lo — está em
[`modelo-proprio.md`](modelo-proprio.md).

O `oracledb` roda em **thin mode**: não precisa instalar Instant Client nem na
sua máquina nem na VM. Basta apontar `ORACLE_WALLET_DIR` para a pasta
descompactada.

---

## 7. Conferir e derrubar tudo

### 7.1 Inventário

```bash
source ~/.oci/diana-env.sh

oci compute instance list -c "$COMPARTMENT_OCID" --output table \
  --query 'data[?"lifecycle-state"!=`TERMINATED`].{nome:"display-name",estado:"lifecycle-state"}'

oci db autonomous-database list -c "$COMPARTMENT_OCID" --output table \
  --query 'data[].{nome:"display-name",estado:"lifecycle-state",free:"is-free-tier"}'

oci network vcn list -c "$COMPARTMENT_OCID" --output table \
  --query 'data[].{nome:"display-name",cidr:"cidr-block"}'
```

### 7.2 Custo

```bash
oci budgets budget list -c "$TENANCY_OCID" --output table 2>/dev/null \
  || echo "sem budget configurado"
```

Com a VM em `VM.Standard.A2.Flex`, **há um recurso cobrado rodando de
propósito** — não é mais um caso de "passou da cota sem perceber". Os dois itens
que contam a hora aqui são a instância e o boot volume dela; o Autonomous
Database em Always Free não entra.

Crie o alerta de orçamento no console (*Billing & Cost Management* → *Budgets*)
**antes** de subir a instância. Um alerta criado depois de uma VM esquecida
ligada por três semanas avisa sobre uma conta que já existe.

A instância parada continua cobrando o armazenamento. Quem para o relógio de
verdade é o `terminate` do passo 7.3.

### 7.3 Derrubar

A ordem importa — a OCI recusa apagar algo que ainda é referenciado:

```bash
# 1. instância (o boot volume vai junto)
oci compute instance terminate --instance-id "$INSTANCE_OCID" \
  --preserve-boot-volume false --force --wait-for-state TERMINATED

# 2. banco
oci db autonomous-database delete --autonomous-database-id "$ADB_OCID" \
  --force --wait-for-state TERMINATED

# 3. rede, de dentro para fora
oci network subnet delete --subnet-id "$SUBNET_OCID" --force --wait-for-state TERMINATED
oci network nsg delete --nsg-id "$NSG_OCID" --force --wait-for-state TERMINATED
oci network internet-gateway delete --ig-id "$IGW_OCID" --force --wait-for-state TERMINATED
oci network vcn delete --vcn-id "$VCN_OCID" --force --wait-for-state TERMINATED

# 4. compartimento
oci iam compartment delete --compartment-id "$COMPARTMENT_OCID" --force
```

> **Apagar o ADB apaga os dados.** Não existe lixeira. Se houver algo que
> interessa guardar, exporte antes.

A exclusão de compartimento é assíncrona e leva alguns minutos; ele fica em
`DELETING` no meio do caminho. Se falhar, é porque sobrou recurso dentro —
`oci search resource structured-search --query-text "query all resources where compartmentId = '$COMPARTMENT_OCID'"`
mostra o que ficou.

---

## Script completo

Para recriar tudo de uma vez. Ele para no primeiro erro (`set -e`) e não
imprime senha nenhuma:

```bash
#!/usr/bin/env bash
# `set -u` aborta nomeando a variável vazia. Sem ele, um OCID em branco vai
# para a Oracle e volta como "compartmentId is not available" — mensagem que
# manda você investigar o compartimento, que está perfeito.
set -euo pipefail

source ~/.oci/diana-env.sh   # precisa de TENANCY_OCID
: "${TENANCY_OCID:?rode 'oci setup config' e preencha ~/.oci/diana-env.sh}"

read -rsp "Senha do ADMIN do ADB: " ADB_ADMIN_PASSWORD; echo
read -rsp "Senha da wallet: " WALLET_PASSWORD; echo

MEU_IP=$(curl -s https://checkip.amazonaws.com)
echo "Liberando acesso apenas para $MEU_IP"

COMPARTMENT_OCID=$(oci iam compartment create -c "$TENANCY_OCID" \
  --name diana --description "Recursos da DIANA" \
  --wait-for-state ACTIVE --query 'data.id' --raw-output)

VCN_OCID=$(oci network vcn create -c "$COMPARTMENT_OCID" \
  --cidr-blocks '["10.0.0.0/16"]' --display-name diana-vcn --dns-label diana \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

RT_OCID=$(oci network vcn get --vcn-id "$VCN_OCID" \
  --query 'data."default-route-table-id"' --raw-output)

IGW_OCID=$(oci network internet-gateway create -c "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" --is-enabled true --display-name diana-igw \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

oci network route-table update --rt-id "$RT_OCID" --force \
  --route-rules "[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"$IGW_OCID\"}]"

SUBNET_OCID=$(oci network subnet create -c "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" --cidr-block "10.0.1.0/24" \
  --display-name diana-subnet-publica --dns-label publica \
  --route-table-id "$RT_OCID" --prohibit-public-ip-on-vnic false \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

NSG_OCID=$(oci network nsg create -c "$COMPARTMENT_OCID" \
  --vcn-id "$VCN_OCID" --display-name diana-nsg \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

oci network nsg rules add --nsg-id "$NSG_OCID" --security-rules "[
  {\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"$MEU_IP/32\",
   \"sourceType\":\"CIDR_BLOCK\",\"isStateless\":false,\"description\":\"SSH\",
   \"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}},
  {\"direction\":\"INGRESS\",\"protocol\":\"6\",\"source\":\"$MEU_IP/32\",
   \"sourceType\":\"CIDR_BLOCK\",\"isStateless\":false,\"description\":\"modelo\",
   \"tcpOptions\":{\"destinationPortRange\":{\"min\":8000,\"max\":8000}}},
  {\"direction\":\"EGRESS\",\"protocol\":\"all\",\"destination\":\"0.0.0.0/0\",
   \"destinationType\":\"CIDR_BLOCK\",\"isStateless\":false,\"description\":\"saida\"}
]"

AD_NAME=$(oci iam availability-domain list -c "$COMPARTMENT_OCID" \
  --query 'data[0].name' --raw-output)

IMAGE_OCID=$(oci compute image list -c "$COMPARTMENT_OCID" \
  --operating-system "Canonical Ubuntu" --operating-system-version "22.04" \
  --shape "VM.Standard.A2.Flex" --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)

# Imagem x86 numa shape ARM falha de um jeito que não se explica sozinho.
IMAGE_NOME=$(oci compute image get --image-id "$IMAGE_OCID" \
  --query 'data."display-name"' --raw-output)
case "$IMAGE_NOME" in
  *aarch64*) : ;;
  *) echo "ABORTANDO: imagem '$IMAGE_NOME' não é aarch64."; exit 1 ;;
esac

INSTANCE_OCID=$(oci compute instance launch \
  --availability-domain "$AD_NAME" -c "$COMPARTMENT_OCID" \
  --subnet-id "$SUBNET_OCID" --nsg-ids "[\"$NSG_OCID\"]" \
  --shape "VM.Standard.A2.Flex" \
  --shape-config '{"ocpus": 2, "memory_in_gbs": 12}' \
  --image-id "$IMAGE_OCID" --boot-volume-size-in-gbs 100 \
  --assign-public-ip true \
  --ssh-authorized-keys-file ~/.ssh/id_ed25519.pub \
  --display-name diana-modelo --vnic-display-name diana-modelo-vnic \
  --wait-for-state RUNNING --query 'data.id' --raw-output)

VM_IP=$(oci compute instance list-vnics --instance-id "$INSTANCE_OCID" \
  --query 'data[0]."public-ip"' --raw-output)

ADB_OCID=$(oci db autonomous-database create -c "$COMPARTMENT_OCID" \
  --db-name dianadb --display-name diana-adb --db-workload OLTP \
  --is-free-tier true --admin-password "$ADB_ADMIN_PASSWORD" \
  --wait-for-state AVAILABLE --query 'data.id' --raw-output)

mkdir -p ~/.oci/diana-wallet
oci db autonomous-database generate-wallet --autonomous-database-id "$ADB_OCID" \
  --password "$WALLET_PASSWORD" --file ~/.oci/diana-wallet/wallet.zip
unzip -o ~/.oci/diana-wallet/wallet.zip -d ~/.oci/diana-wallet/

# Reescreve em vez de acumular linhas a cada execução.
sed -i '/^export \(COMPARTMENT\|VCN\|RT\|IGW\|SUBNET\|NSG\|INSTANCE\|ADB\)_OCID=/d;/^export VM_IP=/d' \
  ~/.oci/diana-env.sh
cat >> ~/.oci/diana-env.sh <<EOF
export COMPARTMENT_OCID="$COMPARTMENT_OCID"
export VCN_OCID="$VCN_OCID"
export RT_OCID="$RT_OCID"
export IGW_OCID="$IGW_OCID"
export SUBNET_OCID="$SUBNET_OCID"
export NSG_OCID="$NSG_OCID"
export INSTANCE_OCID="$INSTANCE_OCID"
export VM_IP="$VM_IP"
export ADB_OCID="$ADB_OCID"
EOF

cat <<FIM

  VM ....... $VM_IP  (ssh ubuntu@$VM_IP)
  wallet ... ~/.oci/diana-wallet/

  No .env do backend, com o IP POR EXTENSO (o .env não expande variável):
    MODEL_SERVER_URL=http://$VM_IP:8000/v1

  Aumentar a VM depois (reinicia sozinha):
    oci compute instance update --instance-id "$INSTANCE_OCID" \\
      --shape-config '{"ocpus": 4, "memory_in_gbs": 48}' --force

  Parar de ser cobrado:
    oci compute instance terminate --instance-id "$INSTANCE_OCID" \\
      --preserve-boot-volume false --force --wait-for-state TERMINATED

FIM
```

Guarde-o **fora** deste repositório (por exemplo `~/.oci/provisionar-diana.sh`)
— ele não contém segredo, mas convive com os arquivos que contêm.

---

## Erros frequentes

| Mensagem | Causa | Saída |
|---|---|---|
| `NotAuthenticated` | chave pública não registrada, ou fingerprint divergente | conferir *My profile* → *API keys* |
| `Out of host capacity` | não há ARM livre na região agora | repetir depois; não é configuração |
| `Out of host capacity` | sem máquina livre da shape pedida | trocar A1 → A2, ou repetir mais tarde |
| `LimitExceeded` | cota da shape esgotada na tenancy | `oci limits resource-availability get` para ver o saldo |
| `Invalid db name` | hífen, underscore, ou nome repetido na tenancy | só letras e números, começando por letra |
| `admin password` rejeitada | contém `"` ou a palavra `admin` | trocar a senha |
| `ServiceError 404` no compartimento recém-criado | propagação | aguardar ~30s |
| `compartmentId is not available` | a variável está **vazia** no shell atual (não é o compartimento) | `source ~/.oci/diana-env.sh` |
| análise sai como `mock` com `ANALYZER=server` | `.env` com `$VAR` literal → fallback silencioso | IP por extenso; ver [6.1](#61-a-armadilha-que-custa-uma-sessão-de-depuração) |
| conecta no NSG mas não na porta | `iptables` da VM | passo [4.7](#47-o-firewall-de-dentro) |
| VM sem internet | rota `0.0.0.0/0` ausente | passo [2.3](#23-rota-de-saída) |

---

## Referências

- [OCI CLI Command Reference](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/) — fonte de todas as sintaxes acima
- [`oci compute instance launch`](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/instance/launch.html)
- [`oci db autonomous-database create`](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/db/autonomous-database/create.html)
- [`oci network vcn create`](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/vcn/create.html)
- [`oci network nsg rules add`](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/network/nsg/rules/add.html)
- [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

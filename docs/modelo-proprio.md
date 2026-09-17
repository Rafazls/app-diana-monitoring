# Modelo próprio — escolher, hospedar e treinar

Guia para rodar o modelo de análise em infraestrutura sua, conectado à DIANA
pelo `ANALYZER=server`.

> **Por que isto existe.** A Generative AI da Oracle não está no Always Free, e
> contas trial esbarram em `429` mesmo com créditos. Hospedar o modelo resolve
> isso — e, no caso deste produto, tem um efeito melhor: a conversa da criança
> não passa por serviço de terceiro.

---

## 1. O que cabe no Always Free

O Always Free da Oracle dá, no total:

| Recurso | Always Free |
|---|---|
| Ampere A1 (ARM) | **2 OCPUs, 12 GB RAM** |
| Armazenamento | 200 GB (boot + block) |
| GPU | ❌ nenhuma |

**Sem GPU, e com 2 núcleos ARM.** Isso é o que determina a escolha do modelo —
não adianta escolher pelo ranking de qualidade e descobrir depois que cada
análise leva três minutos.

---

## 2. Modelos recomendados

Nossa tarefa é específica: ler uma conversa curta em português e devolver um
JSON pequeno dizendo quais dos 10 sinais aparecem. Não precisamos de um modelo
que escreva redação — precisamos de um que siga instrução e entenda português.

### Para começar hoje, sem treinar nada

| Modelo | Tamanho (Q4) | Por quê |
|---|---|---|
| **Qwen2.5 3B Instruct** | ~1,9 GB | **Recomendado.** Multilíngue forte, obedece bem a formato. Foi testado com o nosso prompt e funcionou. |
| Llama 3.2 3B Instruct | ~2,0 GB | Alternativa equivalente, da Meta. |
| Llama 3.2 1B Instruct | ~0,8 GB | Dobro da velocidade, qualidade sensivelmente menor. Use se o 3B ficar lento demais. |
| Gemma 2 2B | ~1,6 GB | Meio-termo. |

**Expectativa honesta de desempenho** em 2 núcleos ARM, sem GPU: um 3B
quantizado gera algo entre 5 e 12 tokens por segundo. Como nossa resposta tem
100–200 tokens, cada análise leva **entre 15 e 40 segundos**.

Isso é aceitável, mas **exige ajustar a cadência**: com batches de 10s, a fila
cresce mais rápido do que esvazia. Configure:

```ini
BATCH_INTERVAL_MS=60000        # um batch por minuto
MODEL_SERVER_TIMEOUT_MS=180000 # 3 min de paciência
```

### Para quando você quiser treinar

Aqui vale uma mudança de abordagem. Nossa tarefa é **classificação
multirrótulo** — dados 10 rótulos, quais se aplicam. Isso não pede um modelo
generativo; pede um **classificador**, e a diferença é grande:

| | LLM 3B generativo | Classificador BERT |
|---|---|---|
| Tamanho | ~2 GB | ~400 MB |
| Tempo por análise (2 cores ARM) | 15–40 s | **< 0,3 s** |
| Saída | texto que precisa virar JSON | rótulos diretos |
| Inventa referência de mensagem | pode | não |
| Custo de treinar | alto | **baixo** |

**Modelo base sugerido:** [`neuralmind/bert-base-portuguese-cased`](https://huggingface.co/neuralmind/bert-base-portuguese-cased)
(BERTimbau) — treinado em português brasileiro, não é tradução de modelo em
inglês. Para o nosso caso, é o candidato mais adequado.

O que falta para esse caminho é **dado rotulado** — veja a seção 5.

---

## 3. Criar a VM na Oracle — passo a passo

O formulário de criação tem várias seções, e cada uma esconde uma decisão que
custa caro se passar batido. Vamos por partes.

☰ → **Compute** → **Instances** → **Create instance**

---

### 3.1 Nome e compartimento

- **Name**: `diana-modelo`
- **Create in compartment**: selecione **`diana`**

> Se você criar no compartimento errado, a política que escrevemos e o controle
> de custo do projeto deixam de valer para esta VM. Confira antes de seguir.

---

### 3.2 Placement — e o erro que mais trava o Always Free

**Availability Domain** é o "prédio" do datacenter onde a máquina nasce.

Deixe no padrão, **mas guarde este ponto**: a capacidade Ampere do Always Free
é disputada, e é comum receber:

```text
Out of host capacity
```

**Isso não é erro seu.** Significa que não há máquina Ampere gratuita livre
naquele momento. O que fazer:

1. Se a região oferecer **mais de um Availability Domain**, troque de AD e
   tente de novo — é o teste mais rápido.
2. Tente em **horários de baixa demanda** (madrugada costuma funcionar).
3. Insista ao longo do dia. Capacidade é liberada quando outras contas
   destroem instâncias.
4. **Não troque de região.** Recursos Always Free só existem na sua **home
   region** — se você criar em outra, será cobrado.

> Existe gente que automatiza a repetição da chamada de criação até passar.
> Funciona, mas comece pelo simples: trocar de AD e tentar em outro horário.

---

### 3.3 Security

Esta é a aba que costuma gerar dúvida — e a resposta curta é: **deixe como
está**.

| Opção | O que faz | Para este projeto |
|---|---|---|
| **Shielded instance** | Secure Boot e TPM, contra adulteração do boot | Ligue **se aparecer disponível** — não custa nada. Nem todo shape oferece. |
| **Confidential computing** | Criptografa a memória em uso | Indisponível em Ampere A1. Ignore. |

Nenhuma das duas é necessária para o modelo funcionar. Se *Shielded instance*
estiver disponível e você ligar, não muda nada no uso — só endurece o boot.

> A segurança que **realmente** importa aqui não está nesta aba: é não expor a
> porta do modelo para a internet (seção 3.7).

---

### 3.4 Image and shape — onde você escolhe o que importa

Clique em **Edit** nesta seção.

**Image:**
- **Change image** → **Canonical Ubuntu** → **22.04**
- Confirme que a imagem é compatível com **aarch64/ARM** (a lista já filtra
  conforme o shape escolhido)

**Shape** — o passo decisivo:
1. **Change shape**
2. Aba **Ampere** (não "AMD" nem "Intel")
3. Selecione **VM.Standard.A1.Flex**
4. Ajuste os controles:
   - **OCPUs**: `2`
   - **Memory (GB)**: `12`

✅ **Procure o selo "Always Free Eligible"** ao lado do shape. Se ele não
aparecer, você vai ser cobrado. Confira antes de prosseguir.

> Não passe de 2 OCPUs / 12 GB: é o teto do Always Free somado em toda a
> tenancy. Com 3 OCPUs, a instância inteira vira paga.

---

### 3.5 Networking

Aqui ficam três decisões importantes.

**Rede:**
- **Primary network**: *Create new virtual cloud network* (se ainda não tiver
  uma) — aceite os nomes e faixas sugeridos
- **Subnet**: *Create new public subnet*
  - Precisa ser **pública** para a VM receber IP acessível de fora

**Configuração de IPv4 — a que você perguntou:**

| Opção | Quando usar |
|---|---|
| **Assign a public IPv4 address: Yes** | Backend roda **fora** da OCI (sua máquina agora) |
| **No** | Backend também na OCI — usa o IP **privado**, mais seguro |

Para começar, marque **Yes**: você vai conectar da sua máquina.

- **Private IPv4 address**: deixe *Automatically assign* — o IP privado é
  atribuído pela subnet e não precisa de escolha
- **IPv6**: deixe desligado; não usamos

> ⚠️ O **IP público é efêmero por padrão** — muda se a instância for parada e
> reiniciada, e aí o `.env` do backend para de funcionar sem aviso claro. Se for
> incomodar, depois de criada vá em **Instance → Attached VNICs → IP addresses**
> e converta o IP público para **Reserved**. Reservado, ele não muda.

---

### 3.6 SSH keys

- **Generate a key pair for me** → **Save private key** (e também a pública)
- Ou **Upload public key files** se você já tem um par

> 🔑 Guarde a chave privada **agora**. A Oracle não a mostra de novo, e sem ela
> não há como entrar na máquina — só recriar a instância.

Depois de baixar, no Linux:

```bash
mv ~/Downloads/ssh-key-*.key ~/.ssh/diana-modelo.key
chmod 600 ~/.ssh/diana-modelo.key
```

O `chmod` não é opcional: o SSH recusa chave com permissão aberta.

---

### 3.7 Boot volume — o armazenamento

| Campo | Valor | Por quê |
|---|---|---|
| **Boot volume size** | **50 GB** | O mínimo é 47 GB. O modelo ocupa ~2 GB, o sistema ~8 GB; 50 dá folga confortável. |
| **Boot volume performance** | *Balanced* (padrão) | Suficiente. Performance maior é cobrada. |
| **Encrypt this volume with a key you manage** | **não marque** | Sem marcar, a Oracle já criptografa com chave gerenciada por ela. Marcar exige um Vault configurado. |
| **Backup policy** | opcional | O Always Free inclui 5 backups. Para um servidor de modelo é dispensável: o que há aqui é sistema e um `.gguf` rebaixável. |

> O Always Free dá **200 GB no total** somando todos os boot e block volumes.
> Com 50 GB nesta VM, sobram 150 GB para o resto.

Clique em **Create**.

---

### 3.8 Liberar a porta — sem abrir para o mundo

A instância sobe com tudo bloqueado. Para o backend alcançar o modelo, é
preciso liberar a porta **em dois lugares** — e é comum lembrar de só um deles,
o que faz o `curl` travar sem mensagem de erro.

#### a) Na rede da Oracle

O caminho moderno é um **Network Security Group**, que vale só para esta
instância — melhor que mexer na Security List, que vale para a subnet toda.

☰ → **Networking** → **Virtual Cloud Networks** → sua VCN → **Network Security
Groups** → **Create NSG**

- **Name**: `diana-modelo-nsg`
- Em **Security Rules**, adicione uma regra de entrada:
  - **Direction**: Ingress
  - **Source Type**: CIDR
  - **Source CIDR**: `SEU.IP.PUBLICO/32`
  - **IP Protocol**: TCP
  - **Destination Port Range**: `8080`

Depois associe o NSG à instância:
**Compute → Instances → `diana-modelo` → Attached VNICs → a VNIC → Edit →
Network Security Groups → adicione `diana-modelo-nsg`**

Descubra seu IP com:

```bash
curl ifconfig.me
```

> 🔒 **Nunca use `0.0.0.0/0` aqui.** Isso publica seu modelo para a internet
> inteira: qualquer um poderia consumi-lo e, pior, os trechos de conversa
> enviados no prompt ficariam ao alcance de quem achasse a porta.
>
> IP residencial costuma mudar. Se o `curl` parar de funcionar do nada,
> reconfira seu IP e atualize a regra.

#### b) No firewall do sistema

Ubuntu na OCI vem com iptables fechado, independente do que a Oracle libera:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

Sem o `netfilter-persistent save`, a regra some no próximo reboot.

---

### 3.9 Conectar e preparar a máquina

```bash
ssh -i ~/.ssh/diana-modelo.key ubuntu@SEU_IP_PUBLICO
```

> Usuário é `ubuntu` na imagem Canonical; em Oracle Linux é `opc`.

Compile o llama.cpp para ARM:

```bash
sudo apt update && sudo apt install -y build-essential cmake git libcurl4-openssl-dev
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_CURL=ON
cmake --build build --config Release -j2
```

> A compilação leva de 10 a 20 minutos em 2 núcleos. Use `-j2`: com mais
> paralelismo a máquina fica sem memória e o build morre sem explicação clara.

Baixe o modelo:

```bash
mkdir -p ~/models
curl -L -o ~/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  "https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf"
```

Teste antes de virar serviço:

```bash
./build/bin/llama-server \
  -m ~/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 \
  -c 4096 -t 2 --parallel 1
```

> **`--parallel 1` não é detalhe.** Por padrão o llama.cpp abre 4 slots e aceita
> 4 requisições ao mesmo tempo — repartindo entre elas os mesmos núcleos. Numa
> VM de 2 OCPUs medimos **1,57 tok/s** com os 4 slots disputando, contra
> **3,79 tok/s** com um só. Quatro análises simultâneas ficam todas lentas
> demais e estouram o timeout do cliente; uma de cada vez termina, e as outras
> apenas esperam. Paralelismo só ajuda quando há núcleo sobrando, o que não é o
> caso aqui.

Em outro terminal, **da própria VM** primeiro:

```bash
curl http://localhost:8080/v1/models
```

Se responder ali mas **não** da sua máquina, o problema é rede (3.8), não o
modelo.

---

### 3.10 Deixar rodando como serviço

```bash
sudo tee /etc/systemd/system/llama.service > /dev/null <<'EOF'
[Unit]
Description=Servidor de modelo da DIANA
After=network.target

[Service]
User=ubuntu
ExecStart=/home/ubuntu/llama.cpp/build/bin/llama-server \
  -m /home/ubuntu/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 -c 4096 -t 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now llama
sudo systemctl status llama
```

`Restart=always` garante que o modelo volte sozinho depois de um reboot da
instância — sem isso, a análise cairia para a heurística silenciosamente até
alguém perceber.

---

### 3.11 Checklist antes de conectar a aplicação

- [ ] Shape mostrava **Always Free Eligible** ao criar
- [ ] Chave privada salva e com `chmod 600`
- [ ] SSH conecta
- [ ] `curl http://localhost:8080/v1/models` responde **dentro da VM**
- [ ] `curl http://IP_PUBLICO:8080/v1/models` responde **da sua máquina**
- [ ] `systemctl status llama` mostra *active (running)*

Só com todos marcados vale ir para a seção 4.

## 4. Conectar a aplicação

No `.env` do backend:

```ini
ANALYZER=server
MODEL_SERVER_URL=http://SEU_IP:8080/v1
MODEL_SERVER_MODEL=qwen2.5-3b-instruct-q4_k_m.gguf
MODEL_SERVER_TIMEOUT_MS=180000

# A inferência é lenta sem GPU: dê espaço entre os batches.
BATCH_INTERVAL_MS=60000
```

Teste a conexão antes de subir o backend:

```bash
curl -s http://SEU_IP:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"x","messages":[{"role":"user","content":"Responda apenas: ok"}],"max_tokens":10}'
```

Se responder, `npm start` e observe:

```text
DIANA backend em ... (análise=server:qwen2.5-3b-instruct-q4_k_m.gguf, ...)
```

> O backend já tolera servidor fora do ar: repete com espaçamento crescente e,
> se não obtiver resposta, analisa pela heurística local. Nenhuma conversa fica
> sem avaliação enquanto a VM reinicia.

### Funciona com qualquer servidor compatível

O código fala o dialeto da API da OpenAI, que virou padrão. Além do llama.cpp,
servem **Ollama**, **vLLM**, **LM Studio** e **TGI** — sem mudar uma linha, só
a URL. Se um dia houver GPU disponível, vLLM é o caminho natural.

---

## 5. Treinar o modelo

### O que falta hoje

Treinar exige **dado rotulado**: conversas com a indicação de quais sinais
aparecem em quais mensagens. Esse conjunto não existe ainda — e é bom que se
tenha clareza disso antes de investir em GPU ou em cluster.

### De onde o dado vai vir

A aplicação **já coleta** a matéria-prima: toda vez que o responsável marca um
alerta como *útil* ou *falso alarme*, isso é um rótulo humano sobre um caso
real (`POST /alerts/:id/feedback`). É o ativo mais valioso do projeto a médio
prazo, e ele se acumula sozinho.

### Caminho realista

1. **Rode em produção com o modelo instruído** (seção 2), sem treinar nada.
2. **Acumule feedback.** Algumas centenas de casos revisados já permitem algo.
3. **Monte o conjunto**: conversa → sinais confirmados. O `AnalysisResult` já
   guarda os `messageIds` de cada sinal, então o rótulo vem quase pronto.
4. **Treine um classificador** BERTimbau multirrótulo. Em CPU leva horas; numa
   GPU de aluguel, minutos. O resultado é um modelo de ~400 MB que responde em
   milissegundos — cabe com folga na VM Always Free.
5. **Meça antes de trocar.** Separe 20% dos dados e compare o classificador
   contra a heurística e contra o modelo instruído. Trocar sem medir é apostar.

### Sobre dados sintéticos

É tentador gerar conversas de aliciamento com um LLM para ter volume. Funciona
para um primeiro ensaio, mas cuidado: o modelo aprende o padrão do *gerador*,
não o do mundo real. Sirva-se disso para validar o pipeline de treino, não para
concluir que a detecção está boa.

### Uma ressalva que não é técnica

Conversas reais de crianças são dado sensível. Montar um conjunto de treino com
elas exige base legal, consentimento e cuidado de armazenamento — e essa
discussão precisa acontecer antes da primeira linha de código de treinamento,
não depois.

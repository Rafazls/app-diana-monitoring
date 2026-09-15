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

## 3. Criar a VM na Oracle

### 3.1 Provisionar

☰ → **Compute** → **Instances** → **Create instance**

- **Name**: `diana-modelo`
- **Compartment**: `diana`
- **Image**: Ubuntu 22.04 (ou Oracle Linux 9)
- **Shape**: **Change shape** → *Ampere* → **VM.Standard.A1.Flex**
  - **OCPUs**: 2
  - **Memory**: 12 GB
  - > Se aparecer *Out of capacity*, tente outro *Availability Domain* ou volte
    > mais tarde — a capacidade Always Free de Ampere é disputada.
- **Boot volume**: 50 GB é suficiente
- **SSH keys**: gere ou envie a sua chave pública

Anote o **IP público** da instância.

### 3.2 Liberar a porta — com cuidado

O servidor de modelo **não pode ficar aberto para a internet**. Quem alcançar
essa porta consegue usar seu modelo à vontade, e ainda enxergar os trechos de
conversa enviados no prompt.

**O jeito certo**, se o backend roda fora da OCI: libere **apenas o seu IP**.

☰ → **Networking** → **Virtual Cloud Networks** → sua VCN → **Security Lists**
→ **Default Security List** → **Add Ingress Rules**

- **Source CIDR**: `SEU.IP.PUBLICO/32` ← **não use `0.0.0.0/0`**
- **Destination Port Range**: `8080`

> Descubra seu IP com `curl ifconfig.me`. Se ele mudar (IP residencial
> costuma mudar), atualize a regra.

**Melhor ainda:** quando o backend também estiver na OCI, use o IP **privado**
da VM e não abra nada para fora.

### 3.3 Instalar o servidor de modelo

Conecte por SSH:

```bash
ssh ubuntu@SEU_IP_PUBLICO
```

Instale o llama.cpp compilado para ARM:

```bash
sudo apt update && sudo apt install -y build-essential cmake git libcurl4-openssl-dev
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
cmake -B build -DLLAMA_CURL=ON
cmake --build build --config Release -j2
```

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
  -c 4096 -t 2
```

Em outro terminal:

```bash
curl http://localhost:8080/v1/models
```

### 3.4 Deixar rodando como serviço

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

O firewall interno do Ubuntu na OCI também bloqueia por padrão:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
sudo netfilter-persistent save
```

---

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

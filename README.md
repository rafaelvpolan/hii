# hii — motor de execução autônoma

**hii** executa tarefas de código de ponta a ponta num repositório-alvo: cria o worktree,
chama a IA, roda os gates, abre o PR — e **para**. Ele não decide se o resultado presta e não
tem tela: quem autora a tarefa e julga o resultado é o painel (**hicode**).

```
hicode  (painel)  →  escreve o card, aprova o preview, julga  →  TUI
hii     (motor)   →  executa o card, gera o PR                →  CLI / daemon
```

A separação é dura: `hii` recusa comando de painel com **exit 2** e nunca abre TUI.

```
$ hii
hii — motor de execucao autonoma (sem TUI: o motor nao tem tela)

  hicode          abre o painel de tarefas
  hii status      estado do daemon + progresso dos cards
  hii start       sobe o motor para executar a fila
```

---

## Os três caminhos (nunca confunda)

Quase todo bug de execução do motor é confusão entre estas três raízes:

| Raiz | O que é | De onde vem |
|---|---|---|
| **`ROOT`** | onde o **motor está instalado** — o código do `hii` | `HICODE_ROOT`, ou o primeiro diretório acima que tenha `runner.ts`, `cards/` ou `config/repos.json` |
| **alvo** | o **repo que a tarefa modifica** | `repoPath(nome)` lido do registro; **nunca versionado** |
| **`workdir`** | o **worktree daquele card**, criado a partir de `origin/main` | `prepareBranch` / `ensureWorktree` |

O motor **nunca** escreve em `ROOT` durante uma tarefa. Se um agente editar o código do próprio
motor, isso é defeito: o `cwd-guard` confina cada agente ao `workdir` do card.

O caminho do alvo mora só na máquina — o registro (`config/repos.json`) é local e não vai para o
git. O motor não tem alvo embutido: **qualquer** repo serve, registrado por
`hii repo add <owner/nome>` (comando do painel).

---

## Instalação

```bash
git clone <hii> ~/projects/podium/hii
cd ~/projects/podium/hii
bun install
bun link                 # publica o comando `hii`
```

`bun link` publica **só `hii`**. O painel publica **só `hicode`** — se os dois declararem o mesmo
nome, o último `bun link` rouba o comando do outro.

### Relinkar não basta: o contrato de ambiente

O motor num clone novo é uma instalação **vazia**: ele resolve `cards/`, `config/repos.json` e
`config/ia.json` **relativo ao próprio `ROOT`**. Aponte o binário para o `hii` sem mais nada e ele
não vê card nenhum — não dá erro, mostra zero, que é pior.

A ponte é o contrato em **`lib/runner/environment-contract.ts`**, a fonte da verdade de quais
variáveis existem, quem as resolve e de que **lado** vivem:

| Variável | Lado | Compartilhada entre clones |
|---|---|---|
| `HICODE_ROOT` | ambos | não (é a instalação) |
| `HICODE_CARDS_DIR` | ambos | **sim** |
| `HICODE_REPOS_FILE` | ambos | **sim** |
| `HICODE_RUNNER_PIDFILE` | ambos | **sim** |
| `HICODE_RUNNER_LOCK` | ambos | **sim** |
| `HICODE_IA_FILE` | ambos | **sim** |
| `HICODE_AGENTS_DIR` | motor | não |
| `HICODE_RUNNER_LOG` | motor | não |
| `HICODE_MODELOS_FILE` | painel | não |

`compartilhada = sim` significa: **os dois processos precisam apontar para o mesmo arquivo**, senão
o painel escreve um card que o motor nunca vê, ou os dois sobem daemon ao mesmo tempo porque cada
um tem seu próprio lock. `lado` diz quem resolve a variável — marcar como compartilhada algo que só
um lado lê é erro, e existe guarda de coerência que reprova isso.

Uso, com o estado ainda no clone do painel:

```bash
set -a; . ~/projects/podium/hicode/.hii-env.sh; set +a
hii status
```

O `.hii-env.sh` é **gerado** do contrato e é gitignored — não escreva à mão.

---

## Comandos

### Daemon

| Comando | O que faz |
|---|---|
| `hii start` | sobe o motor em background |
| `hii stop` | para o daemon |
| `hii restart` | reinicia |
| `hii run` | roda em foreground, sem daemonizar (é aqui que se depura) |
| `hii once` | processa a fila **uma vez** e sai |

Uma instância por estado, garantida por `HICODE_RUNNER_LOCK` (`lib/runner/instance-lock.ts`). O lock
discrimina errno: só `EEXIST` espera; qualquer outro erro **sobe**, em vez de virar espera infinita.

### Acompanhamento

| Comando | O que faz |
|---|---|
| `hii status` | estado do daemon + progresso dos cards |
| `hii watch` | progresso ao vivo |

### Integração

| Comando | O que faz |
|---|---|
| `hii sync` | sincroniza tarefas externas (`HICODE_TASK_SYNC`) |
| `hii init [caminho]` | provisiona `.hii/` num repo-alvo |
| `hii hooks install\|uninstall [caminho]` | gate de pre-push determinístico |

> `hooks install` existe, mas **a auditoria de repositório inteiro nunca entra em pre-push** — ela é
> manual, por decisão explícita. `hooks` instala apenas o gate determinístico do diff que sai.

### O que o motor recusa

`approve`, `reject`, `halt`, `repo`, `contract`, `doctor`, `board`, `rm`, `archive`, `teclas` são do
painel. O motor responde **exit 2** apontando o `hicode`. São portas humanas e de governança: quem
aprova preview, registra alvo e apaga card é o painel, nunca o executor.

---

## Como um card executa

O card (`cards/<NNN-slug>.md`) é a única fonte de verdade editável. Estado e custo são carimbados
pelo motor lendo `cards/runs/*.json` — **nunca** pela fala do modelo.

```
INBOX → READY → [CLARIFY] → [SPECCED] → PLAN_APPROVED → EXECUTING → EXECUTED
      → PREVIEW → PREVIEW_OK → REFINED → TESTS_GREEN → SEC_CLEARED
      → REVIEWED → CLEANED → PR_OPEN ┃ (parede) ┃ MERGED → DEPLOYED
```

`WAITING`, `PAUSED`, `CORRECTING` e `HALTED` são transversais. Estados completos em
`lib/card/types.ts`.

### 1. Executar primeiro

Resultado funcional **mínimo, sem polir** (`EXECUTED`). Nada de teste, refactor ou segurança antes
do preview: valida-se a **intenção** cedo, quando errar é barato.

### 2. Preview

O app sobe no worktree e gera link vivo (`PREVIEW`). A aprovação (`PREVIEW_OK`) é humana; para
mudança sem superfície visual é automática. Rejeição volta a `EXECUTED` **com o motivo**.

Quem decide se há superfície é `lib/runner/classify.ts`, determinístico: sinal visual → `visual`;
sinal não-visual (migration, lint, endpoint, refactor…) → `none`; ambíguo → assume visual, porque
mostrar de graça custa menos que esconder o resultado errado.

### 3. Só então polir

Passos configuráveis em `config/pipeline.json` (override por alvo em `<alvo>/.hii/pipeline.json`):

| Passo | Agente | Gate | Estado |
|---|---|---|---|
| arquitetura | rufus | — | `REFINED` |
| testes | testudo | `test` | `TESTS_GREEN` |
| seguranca | escudo | — | `SEC_CLEARED` |
| review | crivo | — | `REVIEWED` |
| limpeza | pura | — | `CLEANED` |

**Quais** desses rodam é decidido por card em `lib/runner/analyze.ts` (determinístico, zero token):

Os cinco perfis, **na ordem em que `profileOf` decide** (o primeiro que casa ganha):

| Perfil | Quando | O que roda |
|---|---|---|
| **`completo`** | `risk: high` no card | **tudo** — vence até `externo` |
| **`externo`** | ação em ferramenta externa (Notion, Slack via MCP), não código no repo | **nada**, e sem preview: não há o que renderizar |
| **`enxuto`** | cosmético/texto/visual | pula arquitetura, testes e segurança |
| **`deps`** | só dependências, sem lógica/backend/dados | testes + segurança (CVE); pula arquitetura |
| **`padrao`** | o resto | qualidade + review; segurança só por sinal |

Sinal ambíguo cai em `padrao` mas **abre todos os passos** — na dúvida o analisador gasta, não
economiza. Segurança entra sempre que houver sinal de segurança, backend, dados, deps ou ambiguidade;
só é pulada em mudança realmente sem risco. Build e gate codefox no fim valem em **todos** os perfis.

Override no card: `steps: all` (força tudo), `steps: <ids>` (só esses) ou `steps: auto` (default).

### 4. O gate é vinculante e fecha em disco

Build, teste e o gate **codefox** (`lib/runner/codefox-gate.ts`) fecham lendo **exit code real em
disco** — não a afirmação do modelo de que passou. Veredito ausente, diff que falhou ao montar ou
agente que estourou timeout contam como **não concluído**, nunca como aprovado: o gate **falha
fechado**.

### 5. PR — e a parede

O motor abre o PR (`finish.ts` → `PR_OPEN`) e **para**.

> **Merge é SEMPRE humano.** O motor não roda `gh pr merge`. Quem lê o diff e clica é a pessoa, no
> GitHub. É a porta anti-rendição-cognitiva: sem ela o loop se auto-aprova.

`MERGED` só aparece quando `lib/runner/merge.ts` **observa** no GitHub que o merge humano
aconteceu. PR fechada sem merge marca `pr_closed` e mantém o card em `PR_OPEN`.

### Toda task parte do `main` atualizado

Antes da branch: `git fetch origin main` + `pull --ff-only`, ou criar de `origin/main` recém-buscado
no worktree. Nunca ramificar de estado velho nem de outra branch de feature.

---

## Provedores de IA

Papéis: **`implement`**, **`verify`**, **`gate`**, **`step`** — cada um escolhe provedor por env.
Provedores: `claude` (default), `codex`, `ollama`, `kimi`.

Capacidade é **declarada**, não presumida: `providerLimits` em `lib/ai/registry.ts` diz quem
restringe tools, isola leitura, reporta custo e aceita nível de esforço, e `recusaPorLimite`
(`lib/runner/cost-trust.ts`) barra a chamada quando o pedido exige algo que o provedor não entrega —
em vez de mandar e tratar o lixo que volta como resultado.

**Cota estourada PARA.** O motor nunca troca de provedor sozinho para continuar: isso mudaria o
custo e a qualidade da execução sem ninguém autorizar. Comportamento travado por teste.

Saúde do provedor é sondada antes do uso (`lib/ai/health-probe.ts`): `ollama` em
`$HICODE_OLLAMA_URL/api/tags`, `claude` e `codex` por alcançabilidade da API, timeout de 5 s
(`HICODE_HEALTH_PROBE_TIMEOUT_MS`). **Limite conhecido:** provedor fora desse mapa — hoje `kimi` —
cai no `return true` e é reportado como saudável sem ter sido testado.

---

## Segurança operacional

- **`acceptEdits`**, nunca `bypassPermissions`
- **`cwd-guard`** confina cada agente ao worktree do card
- denylist de operações destrutivas — conveniência, **não** fronteira
- banco read-only por role SELECT-only; verificação via MCP com `read_only=true`
- `continuum` **gera** deploy, nunca aplica
- **proibido rodar 24/7 desacompanhado** antes do sandbox (container + egress restrito)

---

## Desenvolvimento

```bash
bun test              # suíte do motor
bun run typecheck     # tsc --noEmit, cobre test/ também
```

Regras impostas por hook, não por convenção: arquivo de código ≤ **350 linhas** e nunca god-file
(≥20 funções e <3 exports); **sem comentário de prosa** (nome revelador no lugar); tudo tipado
`strict`, `any` proibido, toda função com tipo de retorno.

## Estado desta separação

O motor foi extraído do hicode com histórico preservado; por ora os dois repos **duplicam** o
kernel, com unificação depois. Consequência prática: mudança em `lib/core/`, `lib/runner/` ou
`lib/ai/` que valha para os dois precisa ir aos dois — divergência silenciosa é o custo conhecido
desta fase.

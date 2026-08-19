# hii — motor de execução autônoma

**hii** executa tarefas de código de ponta a ponta num repositório-alvo: cria o worktree a partir do
`main` atualizado, chama a IA, entrega uma URL viva para você conferir, roda os gates, abre o PR — e
**para**. Merge é sempre humano.

Você usa por duas portas, no mesmo binário:

```bash
hii              # abre a TUI: escrever tarefa, aprovar, acompanhar
hii <comando>    # CLI direta: subir daemon, ver status, governar cards
```

---

## Onde clonar e como instalar

O motor não precisa morar perto do repo que ele modifica — o alvo é registrado depois, por caminho.

```bash
git clone git@github.com:<owner>/hii.git ~/projects/podium/hii
cd ~/projects/podium/hii
bun install
bun link          # publica o comando `hii` no PATH
```

Confira:

```bash
which hii         # ~/.bun/bin/hii
hii --help
```

Requisitos: **Bun** ≥ 1.3, **git**, **gh** autenticado (`gh auth status`) e pelo menos uma IA de
linha de comando instalada (`claude`, `codex`, `kimi` ou `ollama` local).

> `bun link` daqui publica **só `hii`**. O painel web (hicode) publica **só `hicode`**. Se os dois
> declararem o mesmo nome no `package.json`, o último `bun link` rouba o comando do outro.

### Onde fica o estado

Por padrão o motor guarda tudo dentro do próprio clone: `cards/`, `config/repos.json`,
`config/ia.json`, `.runner.pid`, `.runner.lock`. Se você quer que o estado more em outro lugar —
compartilhado com o painel web, por exemplo — o caminho é o **contrato de ambiente** (seção no fim).

---

## Primeiro uso, em quatro comandos

```bash
# 1. registra o repo que as tarefas vão modificar (fica só na sua máquina)
hii repo add rafaelvpolan/meu-app

# 2. confere se está tudo de pé: gh, IA, daemon, push, contrato do alvo
hii doctor

# 3. sobe o motor
hii start

# 4. escreve a tarefa
hii
```

`repo add` valida o clone, detecta a stack (comandos de dev/build/test) e provisiona `.hii/` no alvo.
Nenhum token de IA é gasto nisso — é determinístico.

---

## Comandos da CLI

### Daemon

| Comando | O que faz |
|---|---|
| `hii start` | sobe o motor em background |
| `hii stop` | para o daemon |
| `hii restart` | reinicia |
| `hii run` | roda em **foreground**, sem daemonizar — é aqui que se depura |
| `hii once` | processa a fila **uma vez** e sai (bom para cron) |

Uma instância por estado, garantida por lock (`lib/runner/instance-lock.ts`). O lock discrimina
errno: só `EEXIST` espera; qualquer outro erro **sobe**, em vez de virar espera infinita.

### Acompanhamento

| Comando | O que faz |
|---|---|
| `hii status` | estado do daemon + progresso dos cards |
| `hii watch` | o mesmo, ao vivo, atualizando sozinho |

```
$ hii status
online (PID 2117058) - log: /home/rpolan/projects/podium/hii/.runner.log

hii — progresso  2026-08-19T14:08:23Z · 11 cards
 pipeline: Fila › Executar › Url › Aprovado › Polir › PR
 Url 1 · PR 10
```

### Portas humanas do card

| Comando | O que faz |
|---|---|
| `hii approve <id>` | você abriu a URL e está certo (`URL` → `URL_OK`) |
| `hii approve <id> --plan` | aprova o plano e enfileira (`READY` → `EXECUTING`) |
| `hii reject <id> [motivo]` | recusa; **com** motivo, pede correção; sem motivo, refaz |
| `hii halt <id> [motivo]` | para o card |

Na TUI essas portas são as teclas `1` / `2` / `3` na pergunta que aparece sobre o prompt.

### Repo-alvo

| Comando | O que faz |
|---|---|
| `hii repo add <owner/nome>` | registra o alvo, valida o clone, provisiona `.hii/` |
| `hii repo ls` | lista os alvos e o estado de cada clone |
| `hii repo rm <owner/nome>` | remove do registro (**não** toca no clone) |
| `hii contract [caminho]` | redetecta a stack e os comandos do alvo |
| `hii doctor` | confere gh, IA, daemon, push e contrato de cada alvo |

### Arquivo de cards

| Comando | O que faz |
|---|---|
| `hii rm <id> [id...] --yes` | apaga cards e limpa worktree, url e runs |
| `hii archive` | arquiva os entregues mais antigos acima do teto |
| `hii archive --dry-run` \| `ls` \| `restore <id>` | simula · lista · traz de volta |
| `hii teclas [--corrigir]` | diagnostica (e ensina) `shift+enter` no seu terminal |
| `hii disco [--limpar]` | uso de disco do estado por área; `--limpar` esvazia o transitório |

### Integração

| Comando | O que faz |
|---|---|
| `hii sync` | sincroniza tarefas externas (`HICODE_TASK_SYNC`) |
| `hii init [caminho]` | provisiona `.hii/` num repo-alvo (default: diretório atual) |
| `hii hooks install\|uninstall [caminho]` | gate de pre-push determinístico |

> `hooks install` instala **apenas** o gate determinístico do diff que está saindo. A auditoria de
> repositório inteiro **nunca** entra em pre-push — ela é manual, por decisão explícita.

---

## A TUI

`hii` sem argumento abre a tela. Ela escolhe o projeto, mostra o **histórico de sessões** do motor
(execuções reais lidas de `cards/runs/*.json`: quando, card, ✓/✗, modelo, duração, custo, tokens) e
aceita texto livre como tarefa.

Comandos de barra dentro da TUI:

| Comando | O que faz |
|---|---|
| `/help` | os comandos e as teclas |
| `/historico` | volta ao histórico de sessões — **sai** da tarefa aberta |
| `/config` | painel das IAs: instaladas, habilitadas, plano, consumo 5 h e semana |
| `/new-task` | força "isto é uma tarefa" (quando o texto parece pergunta) |
| `/new-ask` | força "isto é uma pergunta" (não cria card) |
| `/new-session` | limpa a conversa e começa de novo (e descarta refs ainda soltas na sessão) |
| `/ref <url\|caminho\|clipboard>` | anexa imagem de referência; sem argumento, lista as anexadas |
| `/repo` | troca de projeto |
| `/ia`, `/model`, `/effort` | escolhe provedor, modelo e nível de esforço |
| `/rm <id>` | apaga card |
| `/stop <id>` | para card |
| `/exit` | sai |

Teclas: `↑↓` seleciona a tarefa no rodapé, `enter` entra nela, `←` navega as sessões do histórico
(`enter` abre a tarefa daquela sessão), `1`/`2`/`3` responde a pergunta que está sobre o prompt,
`shift+enter` quebra linha, `pgup`/`pgdn` rola a área de resposta (uma linha nova volta ao vivo).

A resposta da IA sai com **markdown renderizado em ANSI** — cabeçalho, negrito, lista, citação,
bloco de código e link viram formatação, não `##` e `**` na tela.

### Referências de imagem

A TUI não recebe imagem colada pelo terminal: o protocolo só transporta texto. O caminho é o `/ref`:

| Como | O que acontece |
|---|---|
| `/ref https://…/tela.png` | grava a fonte; o download acontece **na execução**, com as guardas de rede (10 MB, 30 s, anti-SSRF) |
| `/ref ~/prints/tela.png` | valida (extensão, tamanho, teto de disco) e **copia** para dentro do estado do motor |
| `/ref clipboard` | lê a imagem do clipboard do SO — `powershell.exe Get-Clipboard -Format Image` no WSL, `wl-paste` no Wayland, `xclip` no X11, `pngpaste` no macOS — e valida pela assinatura do arquivo, não pela extensão |
| `/ref` | lista as referências do alvo e o uso de disco |
| `/ref ambiente` | diz por onde o clipboard seria lido nesta máquina |

Com tarefa aberta, a referência vai para `refs/<tarefa>/` — que **sobrevive a retry e a refazer**,
porque a referência é entrada da tarefa, não da execução. Sem tarefa aberta, fica em
`tmp/sessao/<sessao>/` e **migra** para a tarefa no momento em que você escreve o texto dela. Teto de
8 referências por tarefa; na implementação a IA abre cada uma com a tool `Read`.

Um número puro (`23`) abre aquele card. Navegar o quadro de cards **não** é papel do terminal — isso
é do painel web.

---

## Os três caminhos (nunca confunda)

Quase todo bug de execução é confusão entre estas três raízes:

| Raiz | O que é | De onde vem |
|---|---|---|
| **`ROOT`** | onde o motor está instalado | `HICODE_ROOT`, ou o primeiro diretório acima com `runner.ts`, `cards/` ou `config/repos.json` |
| **alvo** | o repo que a tarefa modifica | `repoPath(nome)`, do registro; **nunca** versionado |
| **`workdir`** | o worktree daquele card, criado de `origin/main` | `prepareBranch` / `ensureWorktree` |

O motor **nunca** escreve em `ROOT` durante uma tarefa: o `cwd-guard` confina cada agente ao
`workdir` do card. Agente editando o código do motor é defeito, não licença.

O caminho do alvo mora só na sua máquina. O motor não tem alvo embutido — **qualquer** repo serve.

---

## Como um card executa

O card (`cards/<NNN-slug>.md`) é a única fonte de verdade editável. Estado e custo são carimbados
pelo motor lendo `cards/runs/*.json` — **nunca** pela fala do modelo.

```
INBOX → READY → [CLARIFY] → [SPECCED] → PLAN_APPROVED → EXECUTING → EXECUTED
      → URL → URL_OK → REFINED → TESTS_GREEN → SEC_CLEARED
      → REVIEWED → CLEANED → PR_OPEN ┃ parede ┃ MERGED → DEPLOYED
```

`WAITING`, `PAUSED`, `CORRECTING` e `HALTED` são transversais. Lista completa em `lib/card/types.ts`.

### 1. Executar primeiro

Resultado funcional **mínimo, sem polir** (`EXECUTED`). Nada de teste, refactor ou segurança antes da
URL aprovada: valida-se a **intenção** cedo, quando errar é barato.

### 2. A URL

O app sobe no worktree e o card recebe `url: http://localhost:<porta>`. Quem decide se há URL é
`lib/runner/classify.ts`, determinístico:

| Superfície | Quando | URL? |
|---|---|---|
| `visual` | página, componente, layout, cor, tema… | sim — abre no navegador |
| `api` | endpoint, rota, auth, webhook, graphql… | sim — URL para chamar |
| `none` | migration, lint, refactor, deps, docs… | não — aprovação automática |

Ambíguo assume `visual`: mostrar de graça custa menos que esconder o resultado errado.

**Se a URL não responde, o motor não desiste nem finge que subiu.** A IA recebe uma instrução
estreita — ajustar só o que impede o arranque (comando de dev, porta, host, env, dependência) sem
mexer no comportamento entregue — e o motor retenta. O teto é `HICODE_URL_AJUSTES` (default 2).
Esgotado, o card chega a você com o relato do que foi tentado; não vira HALT silencioso.

Com URL, a pergunta ao humano é literalmente **"conseguiu abrir a url?"**, com o link na tela:

```
◎ #023 conseguiu abrir a url?
    http://localhost:4331
1  abriu e esta certo — segue para o polimento
2  nao serve — refazer do zero
3  nao abriu / falta algo — dizer o que ajustar
```

`3` volta o card para `EXECUTED` **com o motivo** — a correção é dirigida, não um recomeço.

### 3. Só então polir

Passos configuráveis em `config/pipeline.json` (override por alvo em `<alvo>/.hii/pipeline.json`):

| Passo | Agente | Gate | Estado |
|---|---|---|---|
| arquitetura | rufus | — | `REFINED` |
| testes | testudo | `test` | `TESTS_GREEN` |
| seguranca | escudo | — | `SEC_CLEARED` |
| review | crivo | — | `REVIEWED` |
| limpeza | pura | — | `CLEANED` |

**Quais** rodam sai de `lib/runner/analyze.ts` (determinístico, zero token), na ordem em que
`profileOf` decide — o primeiro que casa ganha:

| Perfil | Quando | O que roda |
|---|---|---|
| `completo` | `risk: high` no card | **tudo** — vence até `externo` |
| `externo` | ação em ferramenta externa (Notion, Slack via MCP), não código no repo | **nada**, e sem URL |
| `enxuto` | cosmético / texto / visual | pula arquitetura, testes e segurança |
| `deps` | só dependências, sem lógica/backend/dados | testes + segurança (CVE) |
| `padrao` | o resto | qualidade + review; segurança só por sinal |

Sinal ambíguo cai em `padrao` mas **abre todos os passos** — na dúvida o analisador gasta, não
economiza. Build e gate codefox no fim valem em **todos** os perfis.

No card: `steps: all` força tudo, `steps: <ids>` roda só esses, `steps: auto` (default) decide.

### 4. O gate é vinculante e fecha em disco

Build, teste e o gate **codefox** (`lib/runner/codefox-gate.ts`) fecham lendo **exit code real em
disco**, não a afirmação do modelo. Veredito ausente, diff que falhou ao montar ou agente que
estourou timeout contam como **não concluído** — o gate **falha fechado**.

### 5. PR — e a parede

O motor abre o PR e para em `PR_OPEN`.

> **Merge é SEMPRE humano.** Não existe `gh pr merge` no motor. `MERGED` só aparece quando
> `lib/runner/merge.ts` **observa** no GitHub que uma pessoa mergeou. PR fechada sem merge marca
> `pr_closed` e mantém o card em `PR_OPEN`.

---

## Provedores de IA

Papéis: `implement`, `verify`, `gate`, `step` — cada um escolhe provedor por env. Provedores:
`claude` (default), `codex`, `ollama`, `kimi`. Veja tudo com `/config` na TUI.

Capacidade é **declarada**, não presumida: `providerLimits` (`lib/ai/registry.ts`) diz quem restringe
tools, isola leitura, reporta custo e aceita nível de esforço; `recusaPorLimite`
(`lib/runner/cost-trust.ts`) barra a chamada quando o pedido exige o que o provedor não entrega — em
vez de mandar e tratar o lixo que volta como resultado.

**Cota estourada PARA.** O motor nunca troca de provedor sozinho para continuar — isso mudaria custo
e qualidade sem ninguém autorizar. Travado por teste.

Saúde é sondada antes do uso (`lib/ai/health-probe.ts`): `ollama` em `$HICODE_OLLAMA_URL/api/tags`,
`claude` e `codex` por alcançabilidade da API, timeout de 5 s
(`HICODE_HEALTH_PROBE_TIMEOUT_MS`). **Limite conhecido:** provedor fora desse mapa — hoje `kimi` —
cai no `return true` e é reportado como saudável sem ter sido testado.

---

## Contrato de ambiente (estado fora do clone)

O motor resolve `cards/`, `config/repos.json` e `config/ia.json` relativo ao próprio `ROOT`. Para
apontar noutro lugar, use as variáveis do contrato — `lib/runner/environment-contract.ts` é a fonte
da verdade de quais existem, quem as resolve e de que **lado** vivem:

| Variável | Lado | Precisa ser a mesma nos dois clones |
|---|---|---|
| `HICODE_ROOT` | ambos | não (cada clone tem a sua) |
| `HICODE_CARDS_DIR` | ambos | **sim** |
| `HICODE_REPOS_FILE` | ambos | **sim** |
| `HICODE_RUNNER_PIDFILE` | ambos | **sim** |
| `HICODE_RUNNER_LOCK` | ambos | **sim** |
| `HICODE_IA_FILE` | ambos | **sim** |
| `HICODE_AGENTS_DIR` | motor | não |
| `HICODE_RUNNER_LOG` | motor | não |
| `HICODE_MODELOS_FILE` | motor | não |

"Precisa ser a mesma" significa: se divergir, o painel escreve um card que o motor nunca vê, ou os
dois sobem daemon ao mesmo tempo porque cada um tem seu próprio lock. Duas guardas de teste protegem
isso: variável de um lado só não pode ser marcada como compartilhada, e variável que declara o outro
lado não pode ter o resolvedor morando aqui.

```bash
set -a; . /caminho/do/.hii-env.sh; set +a
hii status
```

Outras variáveis úteis: `HICODE_URL_AJUSTES` (tentativas de ajuste da URL), `GATE_DIFF_LIMIT`
(orçamento do diff no gate), `HICODE_OLLAMA_URL`, `HICODE_TASK_SYNC`.

**Disco.** O estado cresce por referência de imagem, print de URL e registro de run. O motor mede as
quatro áreas (`refs`, `tmp`, `urls`, `runs`) e mostra o total no rodapé da TUI, na frota e em
`hii disco`. `HICODE_DISCO_ALERTA_MB` (default 200) acende o aviso; `HICODE_DISCO_TETO_MB` (default
1024) **recusa** nova referência em vez de encher o disco; `HICODE_TMP_TTL_H` (default 24) é a idade
com que o daemon poda o transitório de `tmp/` a cada tick.

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
bun test              # 1466 testes
bun run typecheck     # tsc --noEmit, cobre test/ também
```

Regras impostas por hook, não por convenção: arquivo de código ≤ **350 linhas** e nunca god-file
(≥20 funções e <3 exports); **sem comentário de prosa**; tudo tipado `strict`, `any` proibido, toda
função com tipo de retorno.

## Estado desta separação

O motor foi extraído do hicode com histórico preservado, e a TUI veio junto: o fecho de import da
tela arrastava 46 arquivos de kernel, que o painel era obrigado a duplicar só para ter terminal.

O painel (**hicode**) fica com `panel/` — Nuxt 4 + Vue 3 — e é dono do quadro de cards, sprints e
navegação. Por ora ele ainda carrega uma cópia do kernel; ela é **redundante**, não load-bearing, e
pode ser apagada quando o painel web assumir. `hidash` (dashboard genérico) vem depois.

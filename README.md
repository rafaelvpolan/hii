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

> O que ficou em aberto (com o porquê e onde mexer) está em **[PENDENCIAS.md](PENDENCIAS.md)**.

---

## Requisitos

### Bun runtime

O projeto usa **Bun >= 1.3** como runtime. Se você não tem Bun instalado:

```bash
curl -fsSL https://bun.sh/install | bash
```

Confira a versão:

```bash
bun --version        # deve exibir 1.3.0 ou maior
```

Se a saída não aparecer, ou se a versão for menor que 1.3, reinstale seguindo a documentação
em https://bun.sh.

### Git

O motor depende de **git** (qualquer versão recente) para clonar, criar branches e worktrees.

```bash
git --version        # verifica se está instalado
```

Se não estiver, instale via seu gerenciador de pacotes (`apt`, `brew`, `choco`, etc.).

### GitHub CLI (gh)

Necessário para criar PRs automaticamente. O motor usa apenas `gh pr create` — **sem extensões**.

```bash
gh auth status       # confira autenticação
```

Se não estiver autenticado:

```bash
gh auth login        # segue o fluxo interativo
```

Se `gh` não estiver instalado, veja https://cli.github.com.

### IA de linha de comando

O motor fala com pelo menos uma IA. Escolha uma das opções:

**Claude (recomendado)**
- Instale `claude` CLI (https://github.com/anthropics/anthropic-cli)
- Exporte sua chave: `export ANTHROPIC_API_KEY=sk-...`

**Codex / OpenAI**
- Instale `codex` CLI (https://github.com/openai/...)
- Exporte sua chave: `export OPENAI_API_KEY=sk-...`

**Ollama (local, grátis)**
- Instale Ollama em https://ollama.ai
- Lance o daemon: `ollama serve`
- Baixe um modelo:
  ```bash
  ollama pull llama2          # modelo recomendado (4.5 GB, ~4GB RAM livre)
  ollama pull llama3.1        # alternativa maior (8B, ~6GB RAM)
  ```

**Sistema recomendado para Ollama:**
- **llama2** (padrão sugerido): 4–5 GB de RAM livre, ~2.5 GB de disco
- **llama3.1:8b**: 6–7 GB de RAM livre, ~4.7 GB de disco
- **llama3.1:70b** (GPU recomendado): 40+ GB de VRAM ou 70+ GB de RAM

Qualquer falta será detectada em `hii doctor`.

---

## Instalação

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

> `bun link` daqui publica **só `hii`**. O painel web (hicode) publica **só `hicode`**. Se os dois
> declararem o mesmo nome no `package.json`, o último `bun link` rouba o comando do outro.

### Onde fica o estado

Por padrão o motor guarda tudo dentro do próprio clone: `cards/`, `config/repos.json`,
`config/ia.json`, `.runner.pid`, `.runner.lock`. Se você quer que o estado more em outro lugar —
compartilhado com o painel web, por exemplo — o caminho é o **contrato de ambiente** (seção no fim).

---

## Execução

> **Atenção:** A execução depende de você ter completado a **Instalação** e ter acesso a uma
> **IA de linha de comando funcional** (verificável com `hii doctor`).

### Primeiro uso, em quatro comandos

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

Uma instância por estado, garantida por lock (`motor/oswaldo/mutirao/trava-instancia.ts`). O lock discrimina
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

### Para o painel (contrato de máquina)

O painel (hicode) não precisa reimplementar a leitura do estado: pede ao motor.

| Comando | O que faz |
|---|---|
| `hii estado --json` | snapshot inteiro: tarefas com status, fase, passos, url, PR, custo, **pergunta aberta** e o que o humano precisa fazer; mais daemon, saúde, cota e disco |
| `hii estado --revisao` | só o token de revisão — muda quando o estado muda |
| `hii estado --repo <owner/nome>` | filtra por projeto |
| `hii tarefa nova "<texto>" --repo <owner/nome> [--json]` | **cria a tarefa e enfileira** — a porta de disparar, mesma da TUI |
| `hii responder <id> <texto> [--json]` | responde a pergunta aberta e retoma a tarefa |
| `hii approve <id> [--plan] [--json]` | aprova a url (ou o plano) |
| `hii reject <id> [motivo] [--json]` | com motivo pede correção; sem motivo, refaz |
| `hii halt <id> [motivo] [--json]` | para a tarefa |

O painel não só lê o motor: `hii tarefa nova` é a porta de **disparar**, e segue o mesmo caminho da
TUI — sempre tarefa, criada e enfileirada direto, sem leitura de intenção. Repo não registrado é
recusado na porta, em vez de virar card que morre em `HALTED`.

**Tempo real sem socket:** o painel guarda o último `--revisao` e só refaz o trabalho quando o token
vira. `--revisao` é um `readdir` + `stat` local, barato de chamar a cada segundo; o snapshot inteiro
só quando mudou. O campo `versao` diz com qual contrato o painel está falando.

`--json` devolve `{ ok, acao, id, status, mensagem }` — status é o **novo** status depois da ação, para
o painel não precisar reler só para saber o que aconteceu.

**Por que polling e não push.** SSE/HTTP em cima do mesmo snapshot seria possível, mas traz servidor,
porta e superfície de auth para dentro do motor — o que contraria o escopo dele (execução, revisão,
verificação e roteador de IAs). O polling é local e barato. **Só troque se ele doer de verdade.**

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

O gate roda `bun run test`, que inclui **`lint:clone`** — a checagem de que esta árvore sobrevive a um
clone novo, que é o que a CI faz. Ela reprova três coisas que passam nesta máquina e quebram lá:
link rastreado apontando para fora do clone, `bun.lock` fora de sincronia com o `package.json`, e
workflow que chama script ou pasta que não existe no repo.

---

## A TUI

`hii` sem argumento abre a tela. Ela escolhe o projeto, mostra o **histórico de sessões** do motor
(execuções reais lidas de `cards/runs/*.json`: id curto, quando, tarefa, ✓/✗, modelo, duração, custo,
tokens) e aceita texto livre como tarefa.

### Sessão, chamada de IA e tarefa

Uma **sessão do motor** é uma tentativa da tarefa — worktree, implementa, revisa, verifica, PR. Ela
**mistura IAs de propósito**, porque cada papel pode rodar num provedor diferente, e porque o
fallback de cota troca de provedor no meio. A tarefa é atributo da sessão, não o contrário: uma
tarefa tem N sessões.

Toda chamada de IA passa por um funil único (`runProvider`) e vai para o **ledger da sessão**
(`cards/runs/<sessao>.ias.jsonl`), com papel, provedor, modelo, custo, tokens e duração. O registro
da execução embute o agregado por (papel, provedor, modelo). Selecione a sessão com `←` e as IAs de
dentro abrem:

```
 ▸ cjfj hoje 15:32   #011  ✓ claude/opus-5            3m25s   US$0.18    52k
      executa  claude/opus-5              52k   US$0.10
      executa  codex/gpt-5.2               8k   US$0.03
      verifica claude/haiku-4.5            2k   US$0.01 piso
      revisa   codex/gpt-5.2               8k   US$0.01
      poli     claude/sonnet ×2            5k   US$0.03
      ⇄ executa trocou de ia no meio: claude → codex
```

Troca **por papel** é o desenho e não vira evento. Troca **dentro do mesmo papel** é evento e aparece
marcada — é o fallback de cota ou uma substituição de provedor acontecendo. Custo sem reporte do
provedor sai marcado como `piso`, nunca como total.

A **conversa da TUI** (pergunta respondida, leitura de intenção) também é sessão: aparece no
histórico como `chat`, com as IAs que entraram. Antes esse gasto era mostrado na hora e depois
desaparecia — não entrava em nenhum total.

No `/config`, **limite e gasto são coisas diferentes e aparecem separados**. O limite vem do próprio
provedor (o Claude reporta `5h` e `7d` com o instante de reset); o motor só sabe o que **ele** gastou,
que é um subconjunto — seu uso fora do motor também consome o limite. A janela do motor é alinhada ao
reset real do provedor, não corrida a partir de agora, senão os dois números nunca fecham. Leitura do
provedor mais velha que a própria janela sai marcada — um `5h 0%` medido há 6 h não diz nada:

```
5h       ░░░░░░░░░░░░░░░░░░   0% (leitura mais velha que a janela)
         motor US$0.85 · 1 run
7d       ████████████░░░░░░  69%
         motor US$0.85 · 1 run · reseta 2d3h
```

O `/config` e a cota agregam **por chamada de IA** quando há ledger: o gate em `codex` deixa de ser
cobrado do `claude` que implementou. Execuções anteriores ao ledger continuam atribuídas ao provedor
do topo, para o histórico não sumir na virada, e o painel diz qual atribuição está usando
(`atribuicao  2/3 por chamada de ia`). O limite de cota fica no provedor que **bateu** nele, não em
quem apenas participou da mesma execução.

> Enquanto um passo "gated" somar agente + revisor crivo numa métrica só, o custo **por fase**
> (`steps`) não fecha com a soma **por papel**. O ledger é a fonte de verdade das IAs; o `steps`
> segue sendo a visão de progresso.

Comandos de barra dentro da TUI:

| Comando | O que faz |
|---|---|
| `/help` | os comandos e as teclas |
| `/historico` | volta ao histórico de sessões — **sai** da tarefa aberta |
| `/config` | **página própria** das IAs: instaladas, habilitadas, plano, limite por janela e gasto do motor |
| `/new-task` | cria a tarefa explicitamente — mesmo efeito de escrever o texto solto |
| `/new-ask` | pergunta sobre o projeto **sem** criar card — texto solto sempre vira tarefa, então pergunta pede este comando |
| `/new-session`, `/new` | limpa a conversa e começa de novo (e descarta refs ainda soltas na sessão) |
| `/ref <url\|caminho\|clipboard>` | anexa imagem de referência; sem argumento, lista as anexadas |
| `/repo` | troca de projeto |
| `/ia`, `/model`, `/effort` | escolhe provedor, modelo e nível de esforço de cada papel (`implement`, `verify`, `gate`, `step`) |
| `/mode` | modo de operação da IA ativa (`plan`, `acceptEdits`, …); **shift+tab** cicla direto no prompt. Vale para os papéis que editam (`implement`, `step`) — `verify` e `gate` rodam em leitura, então não há edição para aprovar |
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

> **Só o caminho do WSL foi verificado em execução real** (imagem no clipboard do Windows, PNG
> conferido em disco). `wl-paste` (Wayland), `xclip` (X11) e `pngpaste` (macOS) estão cobertos por
> teste com mock, mas nunca rodaram de verdade — trate os três como não verificados até alguém rodar
> `/ref clipboard` de ponta a ponta nessas plataformas.

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

`WAITING`, `PAUSED`, `CORRECTING` e `HALTED` são transversais. Lista completa em `motor/cordel/tipos.ts`.

### 1. Executar primeiro

Resultado funcional **mínimo, sem polir** (`EXECUTED`). Nada de teste, refactor ou segurança antes da
URL aprovada: valida-se a **intenção** cedo, quando errar é barato.

### 2. A URL

O app sobe no worktree e o card recebe `url: http://localhost:<porta>`. Quem decide se há URL é
`motor/oswaldo/rota/superficie.ts`, determinístico:

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

A confirmação técnica é da máquina, não sua: o motor sobe o app, confirma com `curl` (timeout, com
retentativas e ajuste automático se não responder) e, quando responde, abre a página no **Playwright**
para ver se ela renderiza sem erro. O veredito vai para o campo `verify` do card.

Por isso a pergunta ao humano **muda conforme o veredito** — ninguém precisa responder o que a máquina
já sabe:

| `verify` | O que a tela pergunta |
|---|---|
| `ok` | **"é isso que você queria?"** — com `✓ o motor abriu a url e a página respondeu` |
| `falhou` | **"a url subiu com erro — o que fazer?"** |
| `inconclusivo` | **"conseguiu abrir a url?"** — só aqui a pergunta técnica sobra para você |

Quando o veredito é `falhou`, o motor **tenta consertar uma vez** antes de te chamar: manda a IA
corrigir só o que quebra a página (sem refazer o trabalho) e reinspeciona. Deu certo, vira `ok` com o
relato do conserto; não deu, para e o card diz que já houve uma tentativa. Uma, não um loop.

Tarefa **sem URL** (refactor, config, doc) também para para você: em vez de seguir sozinha até o PR,
ela pede **aprovação de funcionalidade** — a mesma tela, com a pergunta "a funcionalidade está certa?".
Nenhuma tarefa chega ao PR sem um checkpoint humano.

O que **nunca** vira automático é a intenção: se a entrega é o que você queria, quem diz é você.

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

**Quais** rodam sai de `motor/oswaldo/rota/perfil.ts` (determinístico, zero token), na ordem em que
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

Build, teste e o gate **codefox** (`motor/ciclo/crivo/gate.ts`) fecham lendo **exit code real em
disco**, não a afirmação do modelo. Veredito ausente, diff que falhou ao montar ou agente que
estourou timeout contam como **não concluído** — o gate **falha fechado**.

### 5. PR — e a parede

O motor abre o PR e para em `PR_OPEN`.

> **Merge é SEMPRE humano.** Não existe `gh pr merge` no motor. `MERGED` só aparece quando
> `motor/quilombo/cartorio/merge.ts` **observa** no GitHub que uma pessoa mergeou. PR fechada sem merge marca
> `pr_closed` e mantém o card em `PR_OPEN`.

---

## Provedores de IA

Papéis: `implement`, `verify`, `gate`, `step` — cada um escolhe provedor por env. Provedores:
`claude` (default), `codex`, `ollama`, `kimi`. Veja tudo com `/config` na TUI.

Capacidade é **declarada**, não presumida: `providerLimits` (`motor/tomada/registro.ts`) diz quem restringe
tools, isola leitura, reporta custo e aceita nível de esforço; `recusaPorLimite`
(`motor/euclides/tesouro/confianca.ts`) barra a chamada quando o pedido exige o que o provedor não entrega — em
vez de mandar e tratar o lixo que volta como resultado.

**Cota estourada PARA.** O motor nunca troca de provedor sozinho para continuar — isso mudaria custo
e qualidade sem ninguém autorizar. Travado por teste.

Saúde é sondada antes do uso (`motor/tomada/sonda.ts`): `ollama` em `$HICODE_OLLAMA_URL/api/tags`,
`claude` e `codex` por alcançabilidade da API, timeout de 5 s
(`HICODE_HEALTH_PROBE_TIMEOUT_MS`). **Limite conhecido:** provedor fora desse mapa — hoje `kimi` —
cai no `return true` e é reportado como saudável sem ter sido testado.

---

## Contrato de ambiente (estado fora do clone)

O motor resolve `cards/`, `config/repos.json` e `config/ia.json` relativo ao próprio `ROOT`. Para
apontar noutro lugar, use as variáveis do contrato — `motor/cordel/alicerce/contrato.ts` é a fonte
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

**Ritmo da URL de preview.** Quanto o motor espera o dev-server responder e a que ritmo sonda:
`HICODE_URL_WAIT_S` (orçamento total, default 30), `HICODE_URL_PROBE_INTERVAL_MS` (intervalo entre
sondas, default 1000), `HICODE_URL_PROBE_TIMEOUT_MS` (teto de cada sonda curl, default 5000),
`HICODE_URL_INSPECT_TIMEOUT_MS` (teto da inspeção playwright, default 60000) e
`HICODE_URL_FREEPORT_SETTLE_MS` (pausa após matar a porta, default 400). Reduzir intervalo/teto
acelera a detecção de "URL no ar"; aumentar ajuda em máquina lenta ou dev-server pesado.

**Janelas de limite por IA.** Cada IA tem sua janela: `HICODE_JANELAS_CLAUDE` (default `5h,7d`),
`HICODE_JANELAS_CODEX`, `HICODE_JANELAS_KIMI`. Aceita `4h`, `30m`, `7d`. IA local não tem janela.

**Disco.** O estado cresce por referência de imagem, print de URL e registro de run. O motor mede as
quatro áreas (`refs`, `tmp`, `urls`, `runs`) e mostra o total no rodapé da TUI, na frota e em
`hii disco`. `HICODE_DISCO_ALERTA_MB` (default 200) acende o aviso; `HICODE_DISCO_TETO_MB` (default
1024) **recusa** nova referência em vez de encher o disco; `HICODE_TMP_TTL_H` (default 24) é a idade
com que o daemon poda o transitório de `tmp/` a cada tick.

---

## Segurança operacional

- **`acceptEdits`**, nunca `bypassPermissions` — e o catálogo de `/mode` não oferece nenhum modo que dispense aprovação (nem `bypassPermissions`, nem `dontAsk`)
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

# OPERAÇÃO — como rodar o motor inteiro

Manual de execução do `hii`: harnesses, skills, agentes, laços e grafos, com
exemplos que você pode colar.

Este documento é **operacional**. Os vizinhos cobrem outra coisa: o `README.md`
instala e apresenta, o `ARQUITETURA-BRAZIL.md` explica os domínios do código, o
`WORKFLOW-EXECUCAO.md` é o plano de modernização por ondas, e o `PENDENCIAS.md`
guarda decisões abertas. Quando um deles discordar deste aqui, **o código manda** —
tudo abaixo foi lido do repositório, e os números conferidos na execução.

---

## Sumário

1. [Os três caminhos de execução](#1-os-três-caminhos-de-execução)
2. [Subir o motor do zero](#2-subir-o-motor-do-zero)
3. [Harnesses — quem executa a IA](#3-harnesses--quem-executa-a-ia)
4. [O grafo de estados do card](#4-o-grafo-de-estados-do-card)
5. [O grafo do pipeline e os perfis](#5-o-grafo-do-pipeline-e-os-perfis)
6. [Agentes](#6-agentes)
7. [Skills e packs](#7-skills-e-packs)
8. [Os laços](#8-os-laços)
9. [Escopo de escrita](#9-escopo-de-escrita)
10. [Custo, teto e cota](#10-custo-teto-e-cota)
11. [Observar o que está acontecendo](#11-observar-o-que-está-acontecendo)
12. [Receitas](#12-receitas)
13. [Quando algo dá errado](#13-quando-algo-dá-errado)
14. [Variáveis de ambiente](#14-variáveis-de-ambiente)

---

## 1. Os três caminhos de execução

Três binários, três propósitos. Confundi-los é a origem da maior parte dos
problemas de operação.

| Caminho | Comando | O que faz |
|---|---|---|
| **Daemon** | `hii start` | Executa cards da fila, continuamente. É quem gasta dinheiro. |
| **TUI** | `hii` (sem argumento) | Superfície humana: escreve tarefa, acompanha, aprova, instrui. |
| **CLI** | `hii <cmd>` | Consulta e operação pontual, sem sessão. Bom para script. |

Os três são o mesmo binário (`bin/hii.ts`); `hii` sem argumento abre a TUI.

O daemon é o único que executa. A TUI e a CLI **enfileiram e observam** — se o
daemon não estiver de pé, o card fica em `READY` e nada acontece. É o sintoma
número um de "o motor não faz nada".

```bash
hii doctor     # confere gh, IA, daemon, push e contrato do alvo
hii status     # estado do daemon + progresso dos cards
```

---

## 2. Subir o motor do zero

```bash
# 1. registrar o alvo — valida o clone e provisiona .hii/
hii repo add org/produto

# 2. conferir o ambiente: gh, IA autenticada, daemon, push, contrato
hii doctor

# 3. subir o motor em background
hii start

# 4. a superfície humana
hii
```

Ciclo de vida do daemon:

```bash
hii start      # daemoniza
hii stop       # para
hii restart    # reinicia
hii run        # foreground — não daemoniza, bom para ver o log direto
hii once       # processa a fila UMA vez e sai (CI, ou depurar um card)
```

Conferir o alvo e o estado local:

```bash
hii repo ls               # alvos registrados e estado de cada clone
hii contract [caminho]    # redetecta stack e comandos do alvo
hii init [caminho]        # provisiona .hii/ num repo-alvo
hii sync                  # sincroniza tarefas externas (HICODE_TASK_SYNC)
```

---

## 3. Harnesses — quem executa a IA

Quatro registrados (`motor/tomada/registro.ts`): **claude**, **codex**, **ollama**,
**kimi**. Cada um é um CLI externo; o motor só monta o argv e lê a saída.

Os valores abaixo foram lidos de `capabilities()` em execução, não do que a
documentação de cada CLI promete:

| Harness | Binário | Isola só-leitura | Reporta custo | Restringe ferramenta | Modos |
|---|---|---|---|---|---|
| claude | `claude` | sim | **sim** | sim | `default`, `acceptEdits`, `plan` |
| codex | `codex` | sim | não | sim | `untrusted`, `on-request`, `never` |
| ollama | `ollama` | sim | sim | não | — |
| kimi | `kimi` | **não** | não | não | `default` |

Escolher, por papel, dentro da TUI:

```
/ia                       # o que está ativo e o que está disponível
/ia kimi                  # troca o provedor
/model K2.7 Coding        # troca o modelo dentro do provedor
/mode acceptEdits         # modo de operação, quando o harness aceita
/effort high              # esforço, quando o harness aceita
```

Todos têm alias em português — `/provedor`, `/modelo`, `/modo`, `/esforco` — e
`/crivo` é alias de `/gauntlet`. São o mesmo comando, não comandos parecidos.

Ou por ambiente, o que é o caminho para script e container:

```bash
HICODE_IMPLEMENT_PROVIDER=kimi HICODE_KIMI_MODEL='K2.7 Coding' hii start
HICODE_GATE_PROVIDER=claude HICODE_GATE_MODEL=opus hii start
```

**O que muda de verdade entre harnesses.** Duas capacidades têm consequência
operacional, e o motor age sobre elas em vez de só declará-las:

- **`isolatesReadonly: false`** — hoje só o **kimi**. O motor **recusa** esse
  harness em papel de verificação, em vez de deixar um verificador editar o que
  deveria julgar. A recusa é verificável:

  ```
  kimi nao sabe rodar em modo somente-leitura (nao restringe ferramenta)
  — um papel de verificacao nele poderia editar arquivo
  ```

- **`reportsCostUsd: false`** — **codex** e **kimi**. O card não acumula `cost_usd`
  por esses, e o teto de orçamento por card não tem o que medir ali. Rodar barato e
  rodar sem contabilidade são coisas diferentes, e essa é a segunda.

O kimi tem uma peculiaridade medida contra o CLI real (0.38.0): em execução única
(`-p`, que é sempre como o motor chama) ele **recusa** `--auto`, `--yolo` e
`--plan` — são flags de sessão interativa. Sem flag nenhum ele já executa e aprova
as ferramentas. Por isso o catálogo de modos dele tem um item só.

---

## 4. O grafo de estados do card

O grafo está declarado como **dado** em `config/topologia.json`, e é conferido em
execução: `updateCard` é o único ponto de escrita, e toda transição passa por lá.
Transição que o código faz e o dado não declara vira **deriva** — vai para o
diário do card e para o stderr, e reprova em `test/niemeyer/deriva-de-transicao.test.ts`.

### Caminho feliz

```
INBOX ──▶ READY ──▶ EXECUTING ──┬──▶ URL ──▶ URL_OK ──▶ REFINED ──▶ TESTS_GREEN
                                │                            (Arquitetura)  (Testes)
                                └──▶ EXECUTED ──▶ URL_OK
                                                     │
   TESTS_GREEN ──▶ SEC_CLEARED ──▶ CLEANED ──▶ PR_OPEN ──▶ MERGED ──▶ DEPLOYED
      (Segurança)      (Limpeza)                   ▲
                                                   └── URL_OK ──▶ PR_OPEN  (perfis leves)
```

### Desvios

```
EXECUTING ──▶ CLARIFY      pergunta ao humano antes de gastar
EXECUTING ──▶ SPECCED      a tarefa virou spec
EXECUTING ──▶ WAITING      falha transitória — espera com backoff
EXECUTING ──▶ PAUSED       o humano parou
URL ──▶ CORRECTING         a URL subiu com erro, ou o humano recusou
```

### Parada

**`HALTED` é alcançável de qualquer estado** — está em `sempreAlcancavel`, ao lado
de `PAUSED`. Parar não depende de rota: se dependesse, o motor não conseguiria
parar exatamente quando algo saiu do previsto. As voltas de `HALTED` estão em
`transicoesDeRecuperacao` (`HALTED → EXECUTING`, `HALTED → URL_OK`).

### Onde o humano decide

`checkpointsHumanos: ["URL", "PR_OPEN"]`. São os dois pontos em que o motor para e
espera. **Merge é sempre humano** — o motor abre o PR e não o fecha.

---

## 5. O grafo do pipeline e os perfis

Depois do `implement`, o fecho roda um pipeline com dependências declaradas
(`motor/niemeyer/config.ts`):

```
Arquitetura (rufus)
     ├──▶ Testes (testudo) ──┐
     └──▶ Segurança (escudo) ┴──▶ Limpeza (pura) ──▶ crivo do fecho ──▶ PR
```

`needs` é o que ordena: `testes` e `seguranca` dependem de `arquitetura`;
`limpeza` depende das duas. `testes` tem `gate: 'test'` — o comando de teste do
alvo tem de passar, com reajuste até o teto.

### Perfis

O motor classifica a tarefa pelo vocabulário do título e do objetivo
(`motor/oswaldo/rota/perfil.ts`) e **corta passos**:

| Perfil | Passos | Quando | Enunciado que cai nele |
|---|---|---|---|
| `completo` | todos | `risk: high`, ou a LEI elevou pelo diff | — |
| `padrao` | todos | o caso comum | *"cálculo de comissão do plano anual"* |
| `deps` | subconjunto | mexe em dependência | *"bump da dependência lodash"* |
| `enxuto` | quase nenhum | texto, cópia, renomeação | *"corrigir o typo do readme"* |
| **`visual`** | **nenhum** | aparência: cor, css, layout, tipografia | *"trocar a cor do botão"* |
| `externo` | nenhum | ação externa, sem alternativa de desenho | — |

Os exemplos da última coluna foram passados por `planSteps` e conferidos; não são
ilustrativos.

O perfil `visual` é o caminho rápido: **implement + crivo do fecho**, duas chamadas
de agente em vez de cinco. Ele não pula verificação — o crivo lê o diff, e o build
do alvo roda igual. O que ele pula são os *agentes* de pipeline.

**Sinal duro sempre vence.** Segurança, backend, dados e dependência tiram a tarefa
do caminho rápido mesmo que ela fale de cor. Duas consequências que não são óbvias:

- `token` é vocabulário de **segurança**, não de estilo. "design token" perde para
  "token de sessão" de propósito: rodar segurança a mais numa troca de paleta custa
  uma chamada de agente; não rodar numa troca de token de auth custa o incidente.
- Palavra **ambígua em português de projeto** não decide nada. `peso`, `tamanho`,
  `classe`, `margem`, `gap`, `tema`, `light`, `contraste` — "margem de lucro",
  "classe de comissão", "gap de cálculo", "plano light" — nenhuma delas dá caminho
  rápido sozinha. Se der, uma mudança de regra de negócio roda sem Testes.

E a **LEI** (`motor/cascudo/lei/`) olha o **diff** depois e só pode **subir** o rigor —
nunca baixar. É o que impede o classificador de enunciado de ser a última palavra.

O perfil escolhido, com o motivo de cada corte, aparece no **plano** — que é o que
você aprova na TUI antes de qualquer gasto — e fica gravado no card em
`steps_profile`, com a explicação no diário.

---

## 6. Agentes

### No pipeline — um agente fixo por passo

| Passo | Agente | Papel |
|---|---|---|
| Arquitetura | `rufus` | refatora sem mudar comportamento observável |
| Testes | `testudo` | cobertura de teste |
| Segurança | `escudo` | OWASP, segredos, XSS, dependências |
| Limpeza | `pura` | remove comentário de prosa (preserva licença, TODO, diretiva) |
| fecho | `crivo` | revisão adversarial lendo o **diff** |

Cada passo com `gated: true` passa pelo crivo do passo; o **crivo do fecho** roda
sempre, inclusive no perfil `visual`, e é o que decide se o PR abre.

### No `implement` — quem escolhe é código, não o modelo

O `implement` tem um menu de especialistas:

```
vitro · frontiteto · limpio · radix · rufus
```

Quem escolhe é `decidirEspecs`, a partir do **diff**, da **dependência declarada no
contrato do alvo** e do **título** da tarefa. O padrão, quando não há sinal nenhum
(card novo, contrato sem framework, título genérico), é `limpio` — **declarado no
código**, não escolhido pelo modelo.

Isso é deliberado. Antes, o prompt entregava o menu inteiro ("frontend → vitro;
banco → radix; …") e mandava a IA rotear: uma escolha que muda de opinião entre
execuções e que ninguém audita depois. Não injetar nada também seria determinístico,
mas perderia capacidade em silêncio — declarar o padrão mantém as duas coisas.

### Os dois modos do crivo

`modoDoCrivo` (`motor/ciclo/canudos/gauntlet.ts`) escolhe:

- **`criterio-escrito`** — padrão. O crivo lê o diff contra o critério escrito.
- **`gauntlet`** — comparação **cega** entre candidatos. Só entra quando: o
  gauntlet está ligado, há teto de orçamento legível, o card ainda não gastou o
  teto, o domínio comporta, **e o card tem referência externa anexada**. Sem
  referência, comparação cega seria opinião com nome novo.

```
/gauntlet             # mostra o modo escolhido e o porquê (alias: /crivo)
/gauntlet on          # liga neste projeto
/ref https://…        # anexa referência — é o que destrava a comparação cega
```

---

## 7. Skills e packs

Packs ficam em `skills/_native/`: `common`, `frontend-web`, `backend-web`,
`mobile`, `devops-deploy`, `games-multiplatform`.

Você não escolhe pack a pack: escolhe um **orquestrador**, que é um atalho de
intake que já liga o conjunto certo.

| Comando | Packs | Para |
|---|---|---|
| `/orquestrador-dev-web` | common, frontend-web, backend-web | front e back |
| `/orquestrador-android` | common, mobile | Android/Kotlin, iOS/Swift, loja |
| `/orquestrador-devops` | common, devops-deploy | pipeline, imagem, deploy, SLO |
| `/orquestrador-jogos` | common, games-multiplatform | engine, netcode, replay |
| `/layout` | common, frontend-web | trabalho visual (liga o modo layout) |

```
/orquestrador-dev-web trocar o hero da home pelo novo banner
```

Os packs entram no prompt do agente daquele card. A **auditoria de harness**
(`vtb`) recusa skill que não passa nos critérios — pack quebrado não carrega em
silêncio.

---

## 8. Os laços

Cinco laços, com propósitos distintos. Confundi-los ao depurar custa tempo.

### 8.1 Laço do daemon

`hii start` (ou `hii run`) faz *tick* continuamente: lê a fila, escolhe o que cabe, executa.

- **Paralelismo**: o menor entre `HICODE_CONCURRENCY` e o que a máquina comporta
  (CPU e memória por worktree). O operador pode **baixar**, não subir acima do
  teto físico — a versão anterior abria 3 worktrees pedindo 6GB contra um limite
  de 4GB.
- **Tick falhando**: três ciclos com o mesmo erro viram alerta; o daemon segue de
  pé em vez de morrer.
- **Encerramento**: `SIGTERM` dispara o encerramento gracioso, que **drena a fila**
  antes de sair e libera a trava de instância.

### 8.2 Laço de reparo

Quando um gate reprova, o motor tenta consertar em vez de parar:
`HICODE_REAJUSTE_RETRIES` (padrão **2**). O reparador é escolhido por domínio — a
saída de um `composer` quebrado não se parece com a de um `tsc` quebrado.

Esgotou as tentativas → `HALTED`, com o worktree preservado para inspeção.

### 8.3 Laço de espera (backoff)

Falha classificada como **transitória** manda o card para `WAITING` com backoff
crescente, até `HICODE_WAITING_MAX_ATTEMPTS`. Falha de **cota** pode trocar de
provedor, se `HICODE_QUOTA_FALLBACK=on`. Falha **terminal** não é repetida —
repetir daria o mesmo resultado.

### 8.4 Laço de divergência (Macunaíma)

Para pergunta **aberta de desenho**, o motor gera N alternativas isoladas e
compara, em vez de iterar uma só. `HICODE_MCN_RAMOS` (padrão **4**) e
`HICODE_MCN_IDEIAS`.

`valeDivergir` decide, e a decisão aparece no plano **antes** de você aprovar.
Enunciado com resposta única (cálculo, comissão, imposto, arredondamento) **não**
diverge: abrir N ramos sobre aritmética gasta N vezes para reencontrar a mesma
resposta.

### 8.5 Laço do gauntlet

Comparação cega entre candidatos, com semente. Só roda sob as condições da seção 6.

---

## 9. Escopo de escrita

Quando o pedido cita caminhos com marca explícita, o motor separa **alvo** de
**referência**:

```
faça a análise de cores conforme o padrão design-system/
e aplique em ui-lab/painel.html
```

- `design-system/` → **referência** (só leitura)
- `ui-lab/painel.html` → **alvo** (escrita)

Aparece no plano que você aprova:

```
    Escreve    ui-lab/painel.html
    So le      design-system
```

E é **cumprido em dois pontos**: depois do `implement`, e no fecho contra
`origin/<base>` (que cobre também o ajuste de URL, o reparo e os passos). Escrever
dentro de uma referência declarada → `HALTED`, com o worktree preservado.

Duas coisas que valem saber:

- **Sem marca explícita, nada muda.** Caminho citado sem marcador não vira alvo nem
  referência, e o worktree segue inteiro gravável. Adivinhar trocaria "editou onde
  não devia" por "não consegue editar onde devia", que é pior de diagnosticar.
- **Proibir é declarar referência.** "não edite `design-system/tokens.css`" marca o
  caminho como só-leitura.

---

## 10. Custo, teto e cota

O gasto acumulado fica no card (`cost_usd`, `tokens_total`), aparece no painel da
tarefa na TUI, e sai inteiro no snapshot para script:

```bash
hii estado              # JSON do motor: daemon, saúde, cota, cards
hii estado --compacto   # o mesmo, menor
hii estado --revisao    # só o token de revisão (para polling barato)
```

- **Teto por card**: `orcamentoPorCard.tetoUsd` em `config/model-tier.json`, ou
  `HICODE_CARD_BUDGET_USD`. Ultrapassar → `HALTED`.
- **Teto global**: `HICODE_BUDGET_USD`.
- **Harness sem contabilidade** (codex, kimi): o teto não tem o que medir. Vale
  repetir porque não é óbvio — e não é o mesmo conjunto dos que não isolam.

---

## 11. Observar o que está acontecendo

Dentro da tarefa, na TUI, o painel do motor fica **fixado** no cabeçalho — não rola
com o feed:

```
    perfil      visual
    escreve em  ui-lab/painel.html
    so le       design-system
    fase        implement
    agentes     limpio
    skills      frontend-web/design-tokens
    ultima acao Edit ui-lab/painel.html
    reparo      implement — tentativa 2/3
    gate        implement: CONDITIONAL
    crivo       criterio-escrito
    gasto       US$0.4210 · 18400 tokens
    FORA ESCOPO design-system/tokens.css
```

`ENTER` sem nada pendente mostra a situação. E **pergunta dentro da tarefa é
respondida na hora**, não vira instrução:

```
oque esta fazendo no barbeiro?     → responde com o estado real
pode trocar o azul?                → é pedido, vira instrução
!tem que trocar o azul             → "!" força instrução
```

Fora da TUI:

```bash
hii status                 # estado do daemon + progresso dos cards
hii watch                  # o mesmo, ao vivo
hii estado                 # snapshot JSON completo (é o que o painel web lê)
hii disco                  # uso de disco do estado (refs, tmp, urls, runs)
hii disco --limpar         # recupera espaço
```

O diário de cada card fica no próprio arquivo do card, em `## Log de Estado` — cada
decisão do motor, em ordem, com a razão. É onde se olha quando algo parou.

Navegar cards **saiu do terminal** de propósito: `board`/`quadro` respondem dizendo
que isso é do painel web.

Health HTTP, para container e monitoração — **só sobe se você pedir**:

```bash
HICODE_HEALTH_PORT=8080 hii start
curl localhost:8080/health
```

Sem `HICODE_HEALTH_PORT`, nada é aberto. O bind é loopback por padrão
(`HICODE_HEALTH_BIND`).

---

## 12. Receitas

### Mudança visual rápida

```
/layout deixe as cores do podium iguais ao padrão barbeiro-frontend/,
aplicando em ui-lab/leaderboard.html
```

Perfil `visual` → zero passo de pipeline, escopo lido do pedido, crivo no fecho.

### Feature com rigor máximo

```bash
hii tarefa nova "cálculo de comissão do plano anual" --repo org/produto
```

Para forçar o perfil `completo`, marque `risk: high` no card (o vocabulário de
segurança, backend e dados também tira a tarefa dos perfis leves sozinho). Com `HICODE_RIGOR_ESTRITO=1`, o perfil
`completo` também exige **evidência de RED**: o passo de testes tem de colar a
saída real do comando de teste reprovando, entre `<<<RED>>>` e `<<<FIM RED>>>`,
antes de implementar.

### Rodar em modelo local, sem custo externo

```bash
HICODE_IMPLEMENT_PROVIDER=ollama HICODE_OLLAMA_MODEL=qwen2.5-coder hii run
```

O ollama isola só-leitura e reporta custo; o que ele não faz é restringir
ferramenta. Quem o motor recusa em papel de verificação é o **kimi**.

### Depurar um card travado

1. `hii status` — em que estado ele parou.
2. O **diário do card** (`## Log de Estado`) — a razão da parada, escrita pelo motor
   na hora em que decidiu.
3. Na TUI, seguir o card: o painel fixado mostra perfil, escopo, fase, reparo, gate
   e gasto sem sair da tela.

Em `HALTED`, o **worktree é preservado** para inspeção. O caminho está no campo
`worktree` do card.

### Parar, aprovar, recusar, responder

```bash
hii halt 42 "vou revisar o escopo"    # para o card
hii approve 42                        # aprova a url entregue (URL -> URL_OK)
hii approve 42 --plan                 # aprova o plano e enfileira
hii reject 42 "o azul ficou escuro"   # com motivo, pede correção
hii responder 42 "use o dourado"      # responde a pergunta aberta da tarefa
hii matriz 42                         # cria/confere a matriz de entendimento
```

### Limpar

```bash
hii rm 42 --yes            # apaga o card e limpa worktree, url e runs
hii archive --dry-run      # o que seria arquivado
hii archive ls             # o que já está arquivado
hii archive restore 42     # traz de volta
```

### Rodar a suíte nos dois runtimes

```bash
bun run test        # typecheck + no-any + clone-limpo + suíte (bun)
bun run test:node   # a MESMA suíte sob node --test
```

Os dois são obrigatórios no CI. O node é o runtime da imagem de produção
(`node:24-slim`), e a suíte rodando só sob bun já deixou passar uma imagem que
morria no arranque.

---

## 13. Quando algo dá errado

| Sintoma | Causa mais provável | O que fazer |
|---|---|---|
| Card fica em `READY` e nada acontece | daemon não está de pé | `hii status`; se offline, `hii start` |
| `HALTED` logo após o implement | escreveu fora do escopo | diário do card diz qual caminho; o worktree está preservado |
| `HALTED` com "o crivo reprovou" | esgotou os reajustes | leia o veredito no diário; `hii reject 42 "<o que corrigir>"` |
| `WAITING` que não sai | falha transitória repetida | `hii estado` mostra esperas e provedores indisponíveis |
| "cota esgotada" | limite do provedor | `HICODE_QUOTA_FALLBACK=on`, ou `/ia <outro>` |
| Perfil `visual` numa tarefa que não é visual | vocabulário do enunciado | reescreva o título, ou marque `risk: high` |
| Perfil pesado numa troca de cor | palavra de sinal duro no enunciado | é deliberado — sinal duro vence estilo |
| Disco crescendo | worktrees e runs acumulados | `hii disco`, depois `hii disco --limpar` |

Duas coisas que **não** são erro:

- **O motor nunca faz merge.** Ele abre o PR e para. Se você está esperando o merge
  automático, está esperando algo que foi decidido não existir.
- **`board` não abre no terminal.** Navegar cards é do painel web; o comando
  responde dizendo isso em vez de fingir.

---

## 14. Variáveis de ambiente

As que mudam comportamento no dia a dia. A lista completa está no código; estas
são as que valem memorizar.

### Provedor e modelo

| Variável | Efeito |
|---|---|
| `HICODE_IMPLEMENT_PROVIDER` | harness do passo de implementação |
| `HICODE_GATE_PROVIDER` / `HICODE_GATE_MODEL` | harness e modelo do crivo |
| `HICODE_VERIFY_PROVIDER` / `HICODE_VERIFY_MODEL` | verificação |
| `HICODE_STEP_PROVIDER` | passos do pipeline |
| `HICODE_CLAUDE_MODEL`, `HICODE_CODEX_MODEL`, `HICODE_KIMI_MODEL`, `HICODE_OLLAMA_MODEL` | modelo por harness |
| `HICODE_QUOTA_FALLBACK=on` | troca de provedor quando a cota estoura |

### Limites e laços

| Variável | Padrão | Efeito |
|---|---|---|
| `HICODE_CONCURRENCY` | teto físico | cards em paralelo (só reduz) |
| `HICODE_REAJUSTE_RETRIES` | 2 | tentativas de reparo por gate |
| `HICODE_CONFLICT_RETRIES` | 2 | tentativas de resolver conflito |
| `HICODE_GATE_RETRIES` | 1 | repetição do gate que não executou |
| `HICODE_WAITING_MAX_ATTEMPTS` | — | teto do backoff |
| `HICODE_MCN_RAMOS` | 4 | ramos de divergência |

### Rigor

| Variável | Efeito |
|---|---|
| `HICODE_RIGOR_ESTRITO=1` | liga as exigências que hoje só escrevem veredito no card |
| `HICODE_CLARIFY` | controla o passo de clarificação |

### Orçamento

| Variável | Efeito |
|---|---|
| `HICODE_BUDGET_USD` | teto global |
| `HICODE_CARD_BUDGET_USD` | teto por card |

### Estado fora do clone

| Variável | Efeito |
|---|---|
| `HICODE_ROOT` | raiz do estado (tem precedência sobre a detecção) |
| `HICODE_CARDS_DIR` | onde ficam os cards |
| `HICODE_REPOS_FILE` | registro de repositórios |
| `HICODE_SECRETS_DIR` | segredos |

### Saúde

| Variável | Efeito |
|---|---|
| `HICODE_HEALTH_PORT` | sobe o servidor de health (sem ela, nada sobe) |
| `HICODE_HEALTH_BIND` | interface (loopback por padrão) |

---

## Antes de ligar `HICODE_RIGOR_ESTRITO=1`

Ligar é ato de **operação**, não de commit: quem liga escolhe o momento em que os
cards em voo podem parar. Ligar com a fila vazia é mais barato que no meio de uma
onda.

Três exigências passam a barrar:

| Item | Exige | Campo no card |
|---|---|---|
| 5 | perfil `completo` teve teste que FALHOU antes de passar | `red_antes_do_green` |
| 22 | área nova tem comando de teste no contrato do alvo | `setup_ferramental` |
| 4 | matriz de entendimento respondida antes de aprovar o plano | `matriz_entendimento` |

Desligado, os três já **escrevem o veredito no card**. Dá para ver, card a card,
quem passaria e quem não — que é o insumo para decidir quando apertar.

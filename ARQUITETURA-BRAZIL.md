# 🇧🇷 ARQUITETURA BRAZIL — taxonomia amarrada ao motor real

Documento de arquitetura do `hii` sob a taxonomia de `brazil-orchestrator-naming.md`, aplicada ao código que existe hoje (333 arquivos `.ts`, ~37.144 linhas, 151 arquivos de teste) e ao que o `MODERNIZATION.md` manda construir (itens 1–32).

Companheiro obrigatório: **`WORKFLOW-EXECUCAO.md`** — este documento diz *o que é cada coisa e como se chama*; o outro diz *em que ordem construir e qual gate fecha cada onda*.

## Princípio, reafirmado

> **Nome brasileiro = comportamento arquitetural.**

Com uma cláusula adicional, específica deste repositório:

> **Todo código só entra na taxonomia se tiver âncora real.** Cada código abaixo aponta para arquivo e símbolo que existem hoje, ou está marcado explicitamente como `NOVO`. Nome sem âncora é decoração, e decoração não sobrevive a refactor.

## Sumário

- [1. O que muda](#1-o-que-muda)
- [2. Taxonomia consolidada — 47 códigos](#2-taxonomia-consolidada--47-códigos)
- [3. Extensões à taxonomia original](#3-extensões-à-taxonomia-original)
- [4. Estrutura de pastas alvo](#4-estrutura-de-pastas-alvo)
- [5. Mapa de rename — arquivo por arquivo](#5-mapa-de-rename--arquivo-por-arquivo)
- [6. Símbolos que mudam de nome](#6-símbolos-que-mudam-de-nome)
- [7. Componentes novos por código](#7-componentes-novos-por-código)
- [8. Os 32 itens do roadmap, por dono](#8-os-32-itens-do-roadmap-por-dono)
- [9. Regras de nomenclatura](#9-regras-de-nomenclatura)
- [10. Colisões e códigos reservados](#10-colisões-e-códigos-reservados)

---

## 1. O que muda

**Decisão tomada:** rename completo agora. Os nomes BRAZIL não são uma camada conceitual em cima do código — são o código.

O que **não** muda, e é inegociável:

| Invariante | Por quê |
|---|---|
| Gate fecha por exit code em disco, nunca por autorrelato do modelo | Princípio central do motor. `Crivo` herda isso, não relaxa |
| Parede humana no merge | `Cartório` formaliza, não afrouxa |
| Cota estourada para, sem troca automática de provedor | `Tomada` + `Tesouro` mantêm |
| Um pipeline de card só — perfis controlam profundidade, não "modos" | Nada nesta taxonomia vira modo novo. São módulos, não modos |
| Zero dependência de framework de orquestração | `Niemeyer` é **dado inspecionável**, não motor de grafo |

### Cinco achados que enxugaram o trabalho

Ao mapear o motor antes de nomear, cinco itens do roadmap se revelaram parcialmente prontos:

| Achado | Onde | Consequência |
|---|---|---|
| Interface de harness **já existe** | `lib/ai/types.ts` — `AiProvider` + `ProviderLimits`; `lib/ai/registry.ts` — `Record<AiProviderName, AiProvider>` | Item 1 é **completar** (`healthCheck()` na interface, MCP em `capabilities`), não criar |
| Repair loop com juiz **já existe** | `lib/runner/gated.ts` — `runGatedStep` faz `runStep` → `runGatedReview` → retry com instrução estreita, teto em `maxReajuste()` | O `runWithRepair` do doc é **generalização** de `Ciclo`, não invenção |
| Ordenação topológica **já existe** | `lib/runner/pipeline/waves.ts` — `waves()` resolve `needs` | `Lúcio` já roda; `config/topologia.json` (item 24) é a foto declarada dela |
| Router determinístico **já existe** | `lib/runner/analyze.ts` — `planSteps` decide perfil por regex, zero token | `Rota` já roda. Falta o eixo do diff (item 2) |
| O nome `crivo` **já é o gate** | `.claude/agents/crivo.md` + `lib/runner/codefox-gate.ts` | `Crivo` não é rename, é reconhecimento |

### Custo honesto do rename

- **172 arquivos** movidos em `lib/` + `bin/lib/` (25 ai · 5 card · 4 contract · 61 core · 64 runner · 1 spec · 4 tasks · 8 bin/lib)
- **151 arquivos de teste** com imports reescritos
- **Zero mudança de comportamento** — é mecânico e verificável: `bun run test` (typecheck + no-any + clone-limpo + 151 suítes) tem de continuar verde depois de **cada** commit da Onda 1
- Nomes de **arquivo de teste ficam como estão** na Onda 1. Só os imports mudam. Renomear teste junto misturaria dois riscos sem ganho
- Todo move via `git mv`, para `git log --follow` sobreviver

---

## 2. Taxonomia consolidada — 47 nomes

26 herdados de `brazil-orchestrator-naming.md`, 21 novos (§3). Coluna **Âncora** = onde vive hoje; `NOVO` = não existe ainda.

> **A abreviatura de três letras foi aposentada em 29/08/2026.** Pasta, arquivo, comentário
> e documento passaram a usar o nome por extenso — `motor/quilombo/cartorio/fechar.ts` em vez
> de `motor/qlb/ctr/fechar.ts`. Quem for ler commit anterior a essa data encontra o código
> curto: a correspondência é a primeira coluna desta tabela, e o mapa completo está no
> commit do rename.

### 2.1 Espinha dorsal

| Nome | Referência | Comportamento | Âncora |
|---|---|---|---|
| **Oswaldo** | Oswaldo Cruz | Orquestrador — dono único do ciclo de vida do card | `lib/runner/execute.ts`, `lib/runner/queue.ts` |
| **Rui** | Rui Barbosa | Estratégia — política acima da execução (perfil, tier, orçamento) | difuso hoje; consolida em `motor/oswaldo/rui.ts` |
| **Rota** | rotas e integração territorial | Router determinístico — quais passos, qual provedor, zero token | `lib/runner/analyze.ts:planSteps`, `lib/ai/registry.ts:providerNameFor` |
| **Niemeyer** | Oscar Niemeyer | Topologia como **dado** — nós, transições permitidas, validação | `lib/runner/pipeline/{config,types}.ts` |
| **Lúcio** | Lúcio Costa | Planejamento estrutural antes de executar — ondas, plano, matriz | `lib/runner/pipeline/waves.ts`, `lib/core/plan.ts` |
| **Ciclo** | ciclos de execução | Agent loop — plan/act/observe/reflect, com teto | `lib/runner/gated.ts`, `lib/runner/agent.ts` |
| **Crivo** | filtragem rigorosa | Hardness / Quality Gate — julga, fecha em disco | `lib/runner/codefox-gate.ts`, `.claude/agents/crivo.md` |
| **Canudos** | Guerra de Canudos | Gauntlet Loop — a solução sobrevive a rodadas de crítica | `NOVO` (item 23) |

### 2.2 Loops, retry e julgamento coletivo

| Nome | Comportamento | Âncora |
|---|---|---|
| **Tijolo** | Execução em blocos com validação incremental — tijolo por tijolo | `NOVO` (item 18) |
| **Reprise** | Retry — nova tentativa após falha, com backoff e teto | `lib/runner/{attempts,failure-policy,waiting,url-ajuste}.ts` |
| **Retirada** | Fallback — abandona rota e tenta alternativa, ou escala pro humano | `lib/runner/failure-policy.ts:applyFailurePolicy` |
| **Roda** | Consenso — múltiplos agentes convergem | `NOVO` |
| **Arena** | Debate — soluções em confronto deliberado | `NOVO` |
| **Voto** | Seleção entre alternativas | `NOVO` |

### 2.3 Harness e ferramentas

| Nome | Comportamento | Âncora |
|---|---|---|
| **Tomada** | Interface de harness — todo provedor pluga igual | `lib/ai/types.ts:AiProvider`, `lib/ai/registry.ts` |
| **Ponte** | Integração / MCP — camada genérica de tools externas | `lib/ai/mcp.ts`, `lib/tasks/` |
| **Mapa** | Registro de ferramentas e capacidades | `lib/ai/comandos-da-ia.ts` |
| **Eco** | Cache e reuso — memo em processo + prefixo estável de prompt | `lib/core/cache.ts` + `NOVO` (item 17) |

### 2.4 Registro, telemetria e custo

| Nome | Comportamento | Âncora |
|---|---|---|
| **Euclides** | Diário append-only — **escreve**, nunca edita. Fonte da retomada | `lib/runner/runs.ts`, `cards/runs/*.jsonl` |
| **Radar** | Telemetria — **lê** Euclides ao vivo: saúde, doctor, `/health` | `lib/core/saude.ts`, `lib/runner/health.ts`, `lib/core/doctor.ts` |
| **Tesouro** | Governança de custo — tier, cota, janela, teto por card | `lib/core/cota*.ts`, `lib/ai/{cost,consumo,janelas,planos}.ts` |

> A separação Euclides/Radar/Tesouro é deliberada. **Euclides escreve e nunca lê pra decidir. Radar lê pra mostrar. Tesouro lê pra barrar.** Um único módulo fazendo os três é como o ledger vira gargalo e ponto cego ao mesmo tempo.

### 2.5 Isolamento e fronteiras

| Nome | Referência | Comportamento | Âncora |
|---|---|---|---|
| **Quilombo** | Palmares — assentamento autônomo e isolado | Isolamento de execução — worktree por card, git local | `lib/runner/git.ts` |
| **Cartório** | cartório brasileiro | Parede humana — nada irreversível sem firma humana | `lib/runner/finish*.ts`, `lib/runner/merge.ts` |
| **Alfândega** | aduana | Fronteira de **entrada** — nada externo entra sem inspeção | `lib/runner/{refs,download,private-net,redirect,url-guard}.ts` |
| **Salvo-conduto** | salvo-conduto | Idempotência — se já passou, não repete o efeito | `NOVO` (itens 25, 27) |
| **Cofre** | cofre | Segredos — env sempre funciona; cofre de nuvem é opcional | `NOVO` (item 29) |

> Alfândega e Cartório são as duas fronteiras, em direções opostas: **Alfândega inspeciona o que entra** (refs, downloads, conteúdo não confiável). **Cartório barra o que sai de forma irreversível** (PR, merge). Confundir as duas é como um gate de segurança vira teatro.

### 2.6 Card, contrato e ambiente

| Nome | Referência | Comportamento | Âncora |
|---|---|---|---|
| **Cordel** | literatura de cordel | O card — unidade de trabalho, história em ordem, fonte de verdade em disco | `lib/card/`, `lib/runner/card-store.ts` |
| **Bússola** | cartografia | Contrato do **repo-alvo** — stack, porta, comandos detectados | `lib/contract/` |
| **Alicerce** | fundação | Contrato de ambiente do **próprio motor** — caminhos, config, hooks | `lib/runner/{config,environment-contract,hicode-home,hooks,ambiente}.ts` |

### 2.7 Conhecimento e regra

| Nome | Referência | Comportamento | Âncora |
|---|---|---|---|
| **Cascudo** | Câmara Cascudo — compilou folclore de muitas fontes num acervo | Acervo de skills multi-origem (`_native`/`_sources`/`_resolved`) + agente de conhecimento | `lib/runner/memory.ts` + `NOVO` |
| **Freire** | Paulo Freire — experiência vivida vira saber que muda a prática | Aprendizado — `aprendiz`, assinatura de problema, limiar de promoção | `NOVO` (item 12) |
| **Lei** | lei | Regras inegociáveis — o que o gate cobra sempre, sem interpretação | `NOVO` (itens 2, 13, 22) |

> **Freire aprende. Lei obriga.** Só sobe de Freire pra Lei por recorrência provada (N cards) **e** decisão humana. Nunca na primeira ocorrência, nunca dentro da mesma sessão que gerou o achado.

### 2.8 Agentes (papéis)

| Nome | Referência | Papel | Âncora |
|---|---|---|---|
| **Rondon** | Marechal Rondon | Research — `search-first`, exploração antes de codar | `NOVO` (item 3) |
| **Dumont** | Santos Dumont | Engineering / Code | `lib/runner/agent.ts:implement` |
| **Assis** | Machado de Assis | Review / Critic | `.claude/agents/crivo.md`, `lib/runner/auditoria.ts` |
| **Senna** | Ayrton Senna | Fast path — classificação, transformação barata | `lib/runner/classify.ts` |
| **Drummond** | Carlos Drummond de Andrade | Deep reasoning — arquitetura, debug complexo | tier1 em `Rui`/`Tesouro` |
| **Tarsila** | Tarsila do Amaral | Creative — UI, UX, ideação, alternativas | `lib/core/ideate.ts`, `lib/runner/design.ts` |
| **Portinari** | Cândido Portinari | Vision — screenshot, UI visual, diagrama | `lib/runner/agent.ts:verifyVisual` |
| **Clarice** | Clarice Lispector | Language — requisito, escrita, documentação | `lib/runner/clarify.ts` + `NOVO` (item 9) |
| **Vital** | **Vital Brazil** — soro antiofídico, Butantan | Security — OWASP, secrets, deps, CVE, e auditoria do próprio harness | `.claude/agents/escudo.md` + `NOVO` (item 14) |
| **Chagas** | **Carlos Chagas** — descreveu vetor, parasita e doença: prova de ciclo completo | Testes — RED antes do GREEN, matriz de cenário | `.claude/agents/testudo.md` |
| **Lina** | **Lina Bo Bardi** — retrofit: transforma a estrutura, preserva o que existe | Refactor sem mudar comportamento observável | `.claude/agents/rufus.md` |
| **Amílcar** | **Amílcar de Castro** — cortar e dobrar; subtração como método | Cleanup — remove o que não pertence | `.claude/agents/pura.md` |
| **Embarque** | embarcar | Empacotamento e deploy — Docker, build matrix, release | `NOVO` (itens 28, 31) |

### 2.9 Interface humana

| Nome | Referência | Comportamento | Âncora |
|---|---|---|---|
| **Mirante** | mirante — de onde se vê tudo | Toda a superfície humana: TUI, render, REPL, comandos, sessão | `lib/core/{tui,render}/`, `lib/core/{dispatch,session}.ts`, `bin/lib/` |
| **Mutirão** | mutirão — trabalho coletivo em lista | Fila, paralelismo entre cards, locks, daemon | `lib/runner/queue.ts`, `lib/core/daemon.ts`, `lib/runner/*-lock.ts` |

---

## 3. Extensões à taxonomia original

`brazil-orchestrator-naming.md` cobre orquestração, loops, grafo, agentes e infraestrutura. Não cobria treze áreas que o motor real tem hoje e que o `MODERNIZATION.md` manda expandir. As 21 extensões abaixo seguem a mesma regra: **referência → comportamento**, nunca homenagem solta.

| Nome | Por que este nome carrega o comportamento |
|---|---|
| **Cordel** | O folheto de cordel conta **uma** história, em ordem, num arquivo barato e portátil. É exatamente o card `.md`: uma tarefa, em ordem, fonte de verdade em disco |
| **Quilombo** | Assentamento autônomo, autossuficiente, isolado do sistema em volta. É o git worktree: cada card com seu território, sem disputar arquivo com ninguém |
| **Mutirão** | Trabalho coletivo percorrendo uma lista, cada um numa frente. É a fila + N cards em paralelo, cada um no seu worktree |
| **Cartório** | No Brasil, ato irreversível pede firma reconhecida por um humano. É a parede humana: plano, URL, PR, merge |
| **Alfândega** | Nada entra no país sem inspeção. É a fronteira de entrada: refs externas, download, SSRF, rede privada, redirect, teto de tamanho |
| **Salvo-conduto** | Documento que atesta "este já foi liberado, não revista de novo". É literalmente a chave de idempotência |
| **Euclides** | Euclides da Cunha cronicou Canudos em *Os Sertões* — registrou o que aconteceu, em ordem, sem reescrever. É o diário append-only. Emparelha com Canudos por construção |
| **Lei** | O que o gate cobra sempre, sem interpretação de modelo |
| **Freire** | Pedagogia de Paulo Freire: experiência vivida, codificada, vira prática nova. É o `aprendiz` promovendo padrão recorrente |
| **Tesouro** | Instituição que governa gasto. É tier de modelo, cota, janela, teto por card |
| **Cofre** | Segredo guardado, aberto por quem tem a chave |
| **Mirante** | Ponto alto de onde se observa tudo. É a TUI e o painel |
| **Bússola** | Instrumento que orienta em terreno desconhecido. É a detecção de stack/porta/comando do repo-alvo |
| **Alicerce** | Fundação sobre a qual tudo se apoia. É o contrato de ambiente do motor |
| **Tomada** | O Brasil tem padrão próprio de tomada: todo aparelho pluga igual. É a interface de harness |
| **Tijolo** | Tijolo por tijolo, e o pedreiro confere o prumo antes do próximo. É o block-executor com validação incremental |
| **Embarque** | Carga pronta e despachada. É empacotamento e deploy |
| **Vital** | Vital Brazil criou o soro antiofídico — defesa específica contra veneno específico. É o agente de segurança, com checklist por stack |
| **Chagas** | Carlos Chagas descreveu o vetor, o parasita e a doença: prova de ciclo completo, sozinho. É o agente de testes que exige RED antes do GREEN |
| **Lina** | Lina Bo Bardi fez do SESC Pompeia um retrofit: mudou a estrutura, preservou a fábrica. É refactor sem mudar comportamento observável |
| **Amílcar** | Amílcar de Castro redesenhou o *Jornal do Brasil* removendo ornamento. Subtração como método. É o cleanup |

---

## 4. Estrutura de pastas alvo

`lib/` passa a se chamar `motor/`. Dez domínios, cada um ancorado num código; códigos com mais de um arquivo ganham subpasta.

```text
hii/
├── bin/                        entrypoints (hii.ts, repl.ts) — não mudam de nome
├── runner.ts                   entrypoint do daemon — não muda de nome
│
├── motor/
│   ├── oswaldo/                    ORQUESTRAÇÃO
│   │   ├── osw.ts                    Oswaldo  ciclo de vida do card
│   │   ├── executar.ts               Oswaldo  handleExecute
│   │   ├── rui.ts                    Rui  estratégia (perfil, tier, orçamento)   NOVO
│   │   ├── despacho-de-agentes.ts    Oswaldo  orchestrator-workers numa fase        NOVO
│   │   ├── rota/                      Rota  router determinístico
│   │   └── mutirao/                      Mutirão  fila, daemon, locks, paralelismo
│   │
│   ├── niemeyer/                    GRAFO E PLANO
│   │   ├── tipos.ts                  Niemeyer  PipelineStep, GateKind
│   │   ├── config.ts                 Niemeyer  leitura de config/pipeline.json
│   │   ├── topologia.ts              Niemeyer  valida transição contra topologia.json NOVO
│   │   ├── passos.ts                 Niemeyer
│   │   ├── lucio/                      Lúcio  ondas, plano, matriz de entendimento
│   │   └── tijolo/                      Tijolo  execução em blocos                     NOVO
│   │
│   ├── ciclo/                    LOOPS E JULGAMENTO
│   │   ├── agente.ts                 Ciclo  invocação de papel (implement/runStep)
│   │   ├── passo-com-gate.ts         Ciclo  runGatedStep
│   │   ├── reparo.ts                 Ciclo  runWithRepair genérico                 NOVO
│   │   ├── corrigir.ts               Ciclo  handleCorrect
│   │   ├── crivo/                      Crivo  gate determinístico + critério escrito
│   │   ├── canudos/                      Canudos  gauntlet loop                          NOVO
│   │   ├── reprise/                      Reprise  retry, backoff, tentativas, reparadores
│   │   ├── rtd.ts                    Retirada  fallback / escalonamento
│   │   ├── roda.ts                    Roda  consenso                               NOVO
│   │   ├── arn.ts                    Arena  debate                                 NOVO
│   │   └── voto.ts                    Voto  voto                                   NOVO
│   │
│   ├── tomada/                    HARNESS E FERRAMENTAS
│   │   ├── tipos.ts                  Tomada  Harness, HarnessCapabilities
│   │   ├── registro.ts               Tomada  Record<id, Harness>
│   │   ├── sonda.ts                  Tomada  healthCheck por harness
│   │   ├── harness/                  Tomada  claude, codex, kimi, ollama, qwen…
│   │   ├── ponte/                      Ponte  MCP + tarefas externas
│   │   ├── mapa/                      Mapa  registro de ferramentas
│   │   └── eco/                      Eco  memo + prefixo estável de prompt
│   │
│   ├── euclides/                    REGISTRO, TELEMETRIA, CUSTO
│   │   ├── diario.ts                 Euclides  append-only, escreve e não decide
│   │   ├── eventos.ts                Euclides  evento por fase (JSONL)                NOVO
│   │   ├── registros.ts              Euclides  runs.ts
│   │   ├── recuperar.ts              Euclides  retomada a partir do diário            NOVO
│   │   ├── radar/                      Radar  saúde, doctor, /health
│   │   └── tesouro/                      Tesouro  custo, cota, janela, tier, orçamento
│   │
│   ├── quilombo/                    ISOLAMENTO E FRONTEIRAS
│   │   ├── git.ts                    Quilombo  worktree, branch, commit
│   │   ├── limites.ts                Quilombo  teto de CPU/memória por worktree       NOVO
│   │   ├── cartorio/                      Cartório  PR, merge, aprovações humanas
│   │   ├── alfandega/                      Alfândega  refs, download, SSRF, redirect
│   │   ├── salvo-conduto/                      Salvo-conduto  idempotência e compensação             NOVO
│   │   └── cofre/                      Cofre  segredos                               NOVO
│   │
│   ├── cordel/                    CARD E CONTRATOS
│   │   ├── tipos.ts                  Cordel  Status, Card, Run, ChamadaDeIa
│   │   ├── store.ts                  Cordel  leitura/escrita do card
│   │   ├── bussola/                      Bússola  contrato do repo-alvo
│   │   └── alicerce/                      Alicerce  contrato de ambiente do motor
│   │
│   ├── cascudo/                    CONHECIMENTO E REGRA
│   │   ├── acervo.ts                 Cascudo  loader de SKILL.md                     NOVO
│   │   ├── resolver.ts               Cascudo  _native + _sources → _resolved         NOVO
│   │   ├── memoria.ts                Cascudo  memória de projeto
│   │   ├── freire/                      Freire  aprendiz, assinatura, promoção         NOVO
│   │   └── lei/                      Lei  guarda determinística de regra         NOVO
│   │
│   ├── agentes/                PAPÉIS
│   │   ├── registro.ts               loadouts lidos de .claude/agents/*.md
│   │   ├── rondon/  dumont/  assis/  senna/  drummond/  tarsila/  portinari/  clarice/
│   │   └── vital/  chagas/  lina/  amilcar/  embarque/
│   │
│   └── mirante/                    INTERFACE HUMANA
│       ├── despacho.ts               Mirante  dispatch do REPL
│       ├── sessao.ts                 Mirante
│       ├── comandos-manuais.ts       Mirante  /orquestrador-* e /layout             NOVO
│       ├── cli/                      Mirante  bin/lib movido pra cá
│       ├── render/                   Mirante
│       └── tui/                      Mirante
│
├── skills/                     ACERVO Cascudo                                        NOVO
│   ├── _native/                skills suas
│   ├── _sources/               adaptações externas, com ORIGIN.json + LICENSE
│   └── _resolved/              GERADA — ninguém edita na mão
│
├── config/
│   ├── pipeline.json           Niemeyer  (existe)
│   ├── repos.json              Cordel  (existe)
│   ├── topologia.json          Niemeyer  item 24                                      NOVO
│   ├── regras-inegociaveis.json Lei item 13                                      NOVO
│   ├── review-criteria.json    Crivo  item 8                                       NOVO
│   ├── model-tier.json         Tesouro  item 19                                      NOVO
│   ├── skill-sources.json      Cascudo  Parte IV                                     NOVO
│   └── security-checklist/     Vital  item 7                                       NOVO
│
├── Dockerfile                  Embarque  item 28                                      NOVO
├── docker-stack.yml            Embarque  item 28 (compose e PROIBIDO por r-0001)      NOVO
├── test/                       espelha motor/ (Onda 1b): test/<dominio>/*.test.ts
└── scripts/
    └── renomear-brazil.mjs     ferramenta da Onda 1                              NOVO
```

---

## 5. Mapa de rename — arquivo por arquivo

Fonte de verdade da Onda 1. `scripts/renomear-brazil.mjs` consome exatamente estas tabelas.

### 5.1 `lib/ai/` → 25 arquivos

| Hoje | Destino | Código |
|---|---|---|
| `lib/ai/types.ts` | `motor/tomada/tipos.ts` | Tomada |
| `lib/ai/registry.ts` | `motor/tomada/registro.ts` | Tomada |
| `lib/ai/provider-config.ts` | `motor/tomada/config.ts` | Tomada |
| `lib/ai/preferencias.ts` | `motor/tomada/preferencias.ts` | Tomada |
| `lib/ai/modos.ts` | `motor/tomada/modos.ts` | Tomada |
| `lib/ai/catalogo.ts` | `motor/tomada/catalogo.ts` | Tomada |
| `lib/ai/disponibilidade.ts` | `motor/tomada/disponibilidade.ts` | Tomada |
| `lib/ai/health-probe.ts` | `motor/tomada/sonda.ts` | Tomada |
| `lib/ai/usage.ts` | `motor/tomada/uso.ts` | Tomada |
| `lib/ai/adapters/claude.ts` | `motor/tomada/harness/claude.ts` | Tomada |
| `lib/ai/adapters/claude-argv.ts` | `motor/tomada/harness/claude-argv.ts` | Tomada |
| `lib/ai/adapters/claude-stream.ts` | `motor/tomada/harness/claude-stream.ts` | Tomada |
| `lib/ai/adapters/codex.ts` | `motor/tomada/harness/codex.ts` | Tomada |
| `lib/ai/adapters/kimi.ts` | `motor/tomada/harness/kimi.ts` | Tomada |
| `lib/ai/adapters/ollama.ts` | `motor/tomada/harness/ollama.ts` | Tomada |
| `lib/ai/ollama-estado.ts` | `motor/tomada/harness/ollama-estado.ts` | Tomada |
| `lib/ai/mcp.ts` | `motor/tomada/ponte/mcp.ts` | Ponte |
| `lib/ai/mcp-estado.ts` | `motor/tomada/ponte/estado.ts` | Ponte |
| `lib/ai/comandos-da-ia.ts` | `motor/tomada/mapa/comandos.ts` | Mapa |
| `lib/ai/agentes-nexus.ts` | `motor/agentes/registro.ts` | — |
| `lib/ai/failure.ts` | `motor/ciclo/reprise/classe-de-falha.ts` | Reprise |
| `lib/ai/cost.ts` | `motor/euclides/tesouro/custo.ts` | Tesouro |
| `lib/ai/consumo.ts` | `motor/euclides/tesouro/consumo.ts` | Tesouro |
| `lib/ai/janelas.ts` | `motor/euclides/tesouro/janelas.ts` | Tesouro |
| `lib/ai/planos.ts` | `motor/euclides/tesouro/planos.ts` | Tesouro |

### 5.2 `lib/card/`, `lib/contract/`, `lib/spec/`, `lib/tasks/` → 14 arquivos

| Hoje | Destino | Código |
|---|---|---|
| `lib/card/index.ts` | `motor/cordel/index.ts` | Cordel |
| `lib/card/types.ts` | `motor/cordel/tipos.ts` | Cordel |
| `lib/card/frontmatter.ts` | `motor/cordel/frontmatter.ts` | Cordel |
| `lib/card/text.ts` | `motor/cordel/texto.ts` | Cordel |
| `lib/card/util.ts` | `motor/cordel/util.ts` | Cordel |
| `lib/contract/types.ts` | `motor/cordel/bussola/tipos.ts` | Bússola |
| `lib/contract/detect.ts` | `motor/cordel/bussola/detectar.ts` | Bússola |
| `lib/contract/probe.ts` | `motor/cordel/bussola/sondar.ts` | Bússola |
| `lib/contract/store.ts` | `motor/cordel/bussola/armazenar.ts` | Bússola |
| `lib/spec/openspec.ts` | `motor/niemeyer/lucio/openspec.ts` | Lúcio |
| `lib/tasks/types.ts` | `motor/tomada/ponte/tarefas/tipos.ts` | Ponte |
| `lib/tasks/registry.ts` | `motor/tomada/ponte/tarefas/registro.ts` | Ponte |
| `lib/tasks/sync.ts` | `motor/tomada/ponte/tarefas/sync.ts` | Ponte |
| `lib/tasks/adapters/github-issues.ts` | `motor/tomada/ponte/tarefas/github-issues.ts` | Ponte |

### 5.3 `lib/runner/` → 64 arquivos

| Hoje | Destino | Código |
|---|---|---|
| `lib/runner/execute.ts` | `motor/oswaldo/executar.ts` | Oswaldo |
| `lib/runner/queue.ts` | `motor/oswaldo/mutirao/fila.ts` | Mutirão |
| `lib/runner/queue-state.ts` | `motor/oswaldo/mutirao/estado-da-fila.ts` | Mutirão |
| `lib/runner/file-lock.ts` | `motor/oswaldo/mutirao/trava-arquivo.ts` | Mutirão |
| `lib/runner/instance-lock.ts` | `motor/oswaldo/mutirao/trava-instancia.ts` | Mutirão |
| `lib/runner/analyze.ts` | `motor/oswaldo/rota/perfil.ts` | Rota |
| `lib/runner/classify.ts` | `motor/oswaldo/rota/superficie.ts` | Rota |
| `lib/runner/externo.ts` | `motor/oswaldo/rota/externo.ts` | Rota |
| `lib/runner/pipeline/types.ts` | `motor/niemeyer/tipos.ts` | Niemeyer |
| `lib/runner/pipeline/config.ts` | `motor/niemeyer/config.ts` | Niemeyer |
| `lib/runner/pipeline/waves.ts` | `motor/niemeyer/lucio/ondas.ts` | Lúcio |
| `lib/runner/spec-phase.ts` | `motor/niemeyer/lucio/fase-spec.ts` | Lúcio |
| `lib/runner/agent.ts` | `motor/ciclo/agente.ts` | Ciclo |
| `lib/runner/gated.ts` | `motor/ciclo/passo-com-gate.ts` | Ciclo |
| `lib/runner/correct.ts` | `motor/ciclo/corrigir.ts` | Ciclo |
| `lib/runner/codefox-gate.ts` | `motor/ciclo/crivo/gate.ts` | Crivo |
| `lib/runner/eval.ts` | `motor/ciclo/crivo/avaliar.ts` | Crivo |
| `lib/runner/finish-gates.ts` | `motor/ciclo/crivo/portoes-de-fecho.ts` | Crivo |
| `lib/runner/url-vivo.ts` | `motor/ciclo/crivo/url-viva.ts` | Crivo |
| `lib/runner/attempts.ts` | `motor/ciclo/reprise/tentativas.ts` | Reprise |
| `lib/runner/failure-policy.ts` | `motor/ciclo/reprise/politica.ts` | Reprise |
| `lib/runner/waiting.ts` | `motor/ciclo/reprise/espera.ts` | Reprise |
| `lib/runner/url-ajuste.ts` | `motor/ciclo/reprise/url-ajuste.ts` | Reprise |
| `lib/runner/provider-trust.ts` | `motor/tomada/confianca.ts` | Tomada |
| `lib/runner/runs.ts` | `motor/euclides/registros.ts` | Euclides |
| `lib/runner/sessao.ts` | `motor/euclides/sessao.ts` | Euclides |
| `lib/runner/ias-da-sessao.ts` | `motor/euclides/ias-da-sessao.ts` | Euclides |
| `lib/runner/estado-em-disco.ts` | `motor/euclides/estado-em-disco.ts` | Euclides |
| `lib/runner/finish-metrics.ts` | `motor/euclides/metricas-de-fecho.ts` | Euclides |
| `lib/runner/podar-registros.ts` | `motor/euclides/podar.ts` | Euclides |
| `lib/runner/health.ts` | `motor/euclides/radar/tick.ts` | Radar |
| `lib/runner/progress.ts` | `motor/euclides/radar/progresso.ts` | Radar |
| `lib/runner/cost-gap.ts` | `motor/euclides/tesouro/lacuna.ts` | Tesouro |
| `lib/runner/cost-trust.ts` | `motor/euclides/tesouro/confianca.ts` | Tesouro |
| `lib/runner/git.ts` | `motor/quilombo/git.ts` | Quilombo |
| `lib/runner/finish.ts` | `motor/quilombo/cartorio/fechar.ts` | Cartório |
| `lib/runner/finish-pr.ts` | `motor/quilombo/cartorio/pr.ts` | Cartório |
| `lib/runner/finish-sync.ts` | `motor/quilombo/cartorio/sync.ts` | Cartório |
| `lib/runner/finish-resume.ts` | `motor/quilombo/cartorio/retomar.ts` | Cartório |
| `lib/runner/merge.ts` | `motor/quilombo/cartorio/merge.ts` | Cartório |
| `lib/runner/responder-pergunta.ts` | `motor/quilombo/cartorio/responder-pergunta.ts` | Cartório |
| `lib/runner/refs.ts` | `motor/quilombo/alfandega/refs.ts` | Alfândega |
| `lib/runner/refs-anexo.ts` | `motor/quilombo/alfandega/anexo.ts` | Alfândega |
| `lib/runner/ref-trust.ts` | `motor/quilombo/alfandega/confianca.ts` | Alfândega |
| `lib/runner/download.ts` | `motor/quilombo/alfandega/download.ts` | Alfândega |
| `lib/runner/private-net.ts` | `motor/quilombo/alfandega/rede-privada.ts` | Alfândega |
| `lib/runner/redirect.ts` | `motor/quilombo/alfandega/redirect.ts` | Alfândega |
| `lib/runner/url-guard.ts` | `motor/quilombo/alfandega/url-guard.ts` | Alfândega |
| `lib/runner/host-resolve.ts` | `motor/quilombo/alfandega/host.ts` | Alfândega |
| `lib/runner/ipv4.ts` | `motor/quilombo/alfandega/ipv4.ts` | Alfândega |
| `lib/runner/loopback.ts` | `motor/quilombo/alfandega/loopback.ts` | Alfândega |
| `lib/runner/card-store.ts` | `motor/cordel/store.ts` | Cordel |
| `lib/runner/config.ts` | `motor/cordel/alicerce/config.ts` | Alicerce |
| `lib/runner/environment-contract.ts` | `motor/cordel/alicerce/contrato.ts` | Alicerce |
| `lib/runner/hicode-home.ts` | `motor/cordel/alicerce/home.ts` | Alicerce |
| `lib/runner/hooks.ts` | `motor/cordel/alicerce/hooks.ts` | Alicerce |
| `lib/runner/ambiente.ts` | `motor/cordel/alicerce/ambiente.ts` | Alicerce |
| `lib/runner/memory.ts` | `motor/cascudo/memoria.ts` | Cascudo |
| `lib/runner/auditoria.ts` | `motor/agentes/assis/auditoria.ts` | Assis |
| `lib/runner/clarify.ts` | `motor/agentes/clarice/clarificar.ts` | Clarice |
| `lib/runner/design.ts` | `motor/agentes/tarsila/design.ts` | Tarsila |
| `lib/runner/ideate-run.ts` | `motor/agentes/tarsila/ideate-run.ts` | Tarsila |
| `lib/runner/commands.ts` | `motor/mirante/comandos.ts` | Mirante |
| `lib/runner/clipboard.ts` | `motor/mirante/clipboard.ts` | Mirante |

### 5.4 `lib/core/` → 61 arquivos

| Hoje | Destino | Código |
|---|---|---|
| `lib/core/daemon.ts` | `motor/oswaldo/mutirao/daemon.ts` | Mutirão |
| `lib/core/passos.ts` | `motor/niemeyer/passos.ts` | Niemeyer |
| `lib/core/plan.ts` | `motor/niemeyer/lucio/plano.ts` | Lúcio |
| `lib/core/cache.ts` | `motor/tomada/eco/memo.ts` | Eco |
| `lib/core/cota.ts` | `motor/euclides/tesouro/cota.ts` | Tesouro |
| `lib/core/cota-runs.ts` | `motor/euclides/tesouro/cota-runs.ts` | Tesouro |
| `lib/core/saude.ts` | `motor/euclides/radar/saude.ts` | Radar |
| `lib/core/doctor.ts` | `motor/euclides/radar/doctor.ts` | Radar |
| `lib/core/archive.ts` | `motor/cordel/arquivar.ts` | Cordel |
| `lib/core/remover.ts` | `motor/cordel/remover.ts` | Cordel |
| `lib/core/repos.ts` | `motor/cordel/repos.ts` | Cordel |
| `lib/core/projetos-conhecidos.ts` | `motor/cordel/projetos-conhecidos.ts` | Cordel |
| `lib/core/config-snapshot.ts` | `motor/cordel/alicerce/snapshot.ts` | Alicerce |
| `lib/core/ideate.ts` | `motor/agentes/tarsila/ideacao.ts` | Tarsila |
| `lib/core/dispatch.ts` | `motor/mirante/despacho.ts` | Mirante |
| `lib/core/session.ts` | `motor/mirante/sessao.ts` | Mirante |
| `lib/core/actions.ts` | `motor/mirante/acoes.ts` | Mirante |
| `lib/core/activity.ts` | `motor/mirante/atividade.ts` | Mirante |
| `lib/core/comandos-de-tarefa.ts` | `motor/mirante/comandos-de-tarefa.ts` | Mirante |
| `lib/core/complete.ts` | `motor/mirante/completar.ts` | Mirante |
| `lib/core/escolher-ia.ts` | `motor/mirante/escolher-ia.ts` | Mirante |
| `lib/core/estado-json.ts` | `motor/mirante/estado-json.ts` | Mirante |
| `lib/core/estado-vazio.ts` | `motor/mirante/estado-vazio.ts` | Mirante |
| `lib/core/historico.ts` | `motor/mirante/historico.ts` | Mirante |
| `lib/core/instruir.ts` | `motor/mirante/instruir.ts` | Mirante |
| `lib/core/progresso.ts` | `motor/mirante/progresso.ts` | Mirante |
| `lib/core/refs-comando.ts` | `motor/mirante/refs-comando.ts` | Mirante |
| `lib/core/responder.ts` | `motor/mirante/responder.ts` | Mirante |
| `lib/core/watch.ts` | `motor/mirante/watch.ts` | Mirante |
| `lib/core/render/**` (24 arquivos) | `motor/mirante/render/**` | Mirante |
| `lib/core/tui/**` (8 arquivos) | `motor/mirante/tui/**` | Mirante |

### 5.5 `bin/` → 8 arquivos movidos + 3 inalterados

| Hoje | Destino | Código |
|---|---|---|
| `bin/hii.ts` | *inalterado* | — |
| `bin/repl.ts` | *inalterado* | — |
| `runner.ts` | *inalterado* | — |
| `bin/lib/board-tui.ts` | `motor/mirante/cli/board-tui.ts` | Mirante |
| `bin/lib/comandos.ts` | `motor/mirante/cli/comandos.ts` | Mirante |
| `bin/lib/dados.ts` | `motor/mirante/cli/dados.ts` | Mirante |
| `bin/lib/estado.ts` | `motor/mirante/cli/estado.ts` | Mirante |
| `bin/lib/preflight.ts` | `motor/mirante/cli/preflight.ts` | Mirante |
| `bin/lib/rodape-tui.ts` | `motor/mirante/cli/rodape-tui.ts` | Mirante |
| `bin/lib/saida.ts` | `motor/mirante/cli/saida.ts` | Mirante |
| `bin/lib/tela-tarefa.ts` | `motor/mirante/cli/tela-tarefa.ts` | Mirante |

### 5.6 O que reescrita de import NÃO alcança

Lista fechada, levantada durante a execução da Onda 1 — não é estimativa. O
`scripts/renomear-brazil.mjs` detecta e **reporta** os dois primeiros padrões
em vez de deixá-los quebrar em silêncio; os demais foram varridos à mão.

| Padrão | Onde apareceu | Por que escapa |
|---|---|---|
| `import()` com template literal e cache-buster | `test/config-root.test.ts:9` | O especificador é `` `../…/config?${SUFIXO}` `` — interpolado, não é string literal |
| Caminho montado por segmentos em `join()` | `test/refs-recusa-no-card.ts`, `test/provedor-removido.ts`, `test/daemon-arranque.ts` | `join(REPO, 'lib', 'runner', 'agent')` — não existe string única para casar |
| Import de runtime concatenado | `.claude/skills/verificar/SKILL.md:52` | `import(process.cwd() + "/lib/runner/auditoria.ts")` — a barra inicial quebra o casamento exato |
| Raiz de varredura de ferramenta | `tsconfig.json` (`include`), `scripts/check-no-any.mjs` (`ROOTS`) | É diretório, não módulo. Durante a Onda 1 apontam para os **dois** lados; `lib` sai no commit 1.10 |
| Caminho como **dado** entre aspas | `motor/cordel/alicerce/contrato.ts` (`resolvidoPor: ['…']`) | Não é import — mas `test/environment-contract.test.ts:45` valida que o caminho existe em disco, então tem de acompanhar. O script cobre isso |
| Prosa em documentação | `README.md`, `.claude/skills/*/SKILL.md` | Cobertos pelo passo de caminho-como-dado quando entre aspas ou crases; o resto é manual |

**Testes movidos na Onda 1b:** `test/` passou a espelhar os dez domínios de
`motor/`. Isso expôs uma classe de caminho que a §5.6 não previa — **raiz do
repositório calculada à mão** (`join(import.meta.dir, '..')`, `dirname(import.meta.dir)`)
e caminho para `test/fixtures/`. Mover o arquivo muda a profundidade, e essas
linhas quebram em silêncio: 30 testes reprovaram na primeira passada.
`scripts/renomear-testes-brazil.mjs` detecta e reporta os quatro padrões, e
`test/mapa-de-testes.test.ts` guarda o invariante.

**Os três documentos de plano** (`ARQUITETURA-BRAZIL.md`, `WORKFLOW-EXECUCAO.md`,
`MODERNIZATION.md`) ficam **fora** de qualquer reescrita automática: a §5 acima
cita origem *e* destino entre crases e é a fonte do mapa — reescrevê-la
destruiria o próprio mapa. Isso já aconteceu uma vez durante a Onda 1 e o
commit 1.1 registra a correção.

**Falso positivo conhecido do detector:** `test/contract-probe.test.ts:93` usa
`join(r, 'node_modules', 'lib')` — é caminho de dependência, não do motor.

---

## 6. Símbolos que mudam de nome

> **Estado: PLANO, não registro.** A auditoria do Nexus (Glossia) pegou esta
> seção afirmando como feito o que não foi. Dos renames abaixo, **só dois
> aconteceram** — `AiProvider → Harness` e `ProviderLimits → HarnessCapabilities`,
> ambos na Onda 2, junto da feature que já mexia naquele arquivo (regra R8 do
> `WORKFLOW-EXECUCAO.md`). Os demais continuam pendentes, e a coluna **Estado**
> abaixo diz qual é qual. Nenhum vira onda própria: cada um entra quando a onda
> que já toca aquele arquivo passar por ele.

Rename de arquivo é mecânico. Rename de símbolo é semântico e vale só onde o nome novo **explica melhor**. Lista curta e deliberada:

| Hoje | Vira | Onde | Por quê | Estado |
|---|---|---|---|---|
| `AiProvider` | `Harness` | `motor/tomada/tipos.ts` | É o contrato Tomada. "Provider" confunde com o serviço; "Harness" é o encaixe | ✅ feito |
| `AiProviderName` | `HarnessId` | `motor/tomada/tipos.ts` | Passa a aceitar id arbitrário (qwen, deepseek) sem editar união | ✅ feito |
| `ProviderLimits` | `HarnessCapabilities` | `motor/tomada/tipos.ts` | Vira o que o harness **pode**, não só o que não pode. Ganha `mcp: boolean` | ✅ feito |
| `providerFor` / `providerNameFor` | `harnessPara` / `harnessDoPapel` | `motor/tomada/registro.ts` | Consistência de idioma com o resto do motor | ⏳ pendente |
| `runGatedStep` | `passoComCrivo` | `motor/ciclo/passo-com-gate.ts` | Diz quem julga | ⏳ pendente |
| `runGatedReview` | `julgarComCrivo` | `motor/ciclo/crivo/gate.ts` | Idem | ⏳ pendente |
| `planSteps` | `rotearPassos` | `motor/oswaldo/rota/perfil.ts` | É Rota decidindo rota | ⏳ pendente |
| `waves` | `ondas` | `motor/niemeyer/lucio/ondas.ts` | Idioma | ⏳ pendente |
| `writeRun` / `readRunSteps` | `anexarNoDiario` / `lerPassosDoDiario` | `motor/euclides/registros.ts` | Deixa explícito que Euclides é append-only | ⏳ pendente |
| `AgentRole` | `Papel` | `motor/cordel/tipos.ts` | Idioma; e `PapelDeChamada` já existe em português no mesmo arquivo | ⏳ pendente |
| `maxReajuste()` | `tetoDeReprise()` | `motor/cordel/alicerce/config.ts` | Amarra ao código Reprise | ⏳ pendente |

O que **não** muda de nome, de propósito: `Status`, `Card`, `Run`, `StepMetric`, `Usage`, `FailureClass` — já estão certos, aparecem em dezenas de testes, e renomear compra risco sem comprar clareza.

---

## 7. Componentes novos por código

Tudo aqui é `NOVO`. Coluna **Item** = número no roadmap consolidado do `MODERNIZATION.md` (Parte VII).

| Nome | Arquivo | O que faz | Item |
|---|---|---|---|
| Tomada | `motor/tomada/tipos.ts` (estende) | `healthCheck()` na interface, `capabilities().mcp` | 1 |
| Tomada | `motor/tomada/sonda.ts` (estende) | Probe real do `kimi` — hoje é `return true` | Parte I §3.7 |
| Rui | `motor/oswaldo/rui.ts` | Estratégia: escolhe perfil, tier e orçamento antes de Rota rotear | 19 |
| Oswaldo | `motor/oswaldo/despacho-de-agentes.ts` | Orchestrator-workers dentro de uma fase; paralelo quando as skills não tocam os mesmos arquivos | 11 |
| Niemeyer | `motor/niemeyer/topologia.ts` + `config/topologia.json` | Grafo declarado como **dado**. Valida transição, não executa | 24 |
| Lúcio | `motor/niemeyer/lucio/matriz-entendimento.ts` | Artefato obrigatório antes da Fase 5 — Pilar 1 | 20 |
| Tijolo | `motor/niemeyer/tijolo/blocos.ts` | Bloco → valida → próximo. Para cedo em base quebrada | 18 |
| Ciclo | `motor/ciclo/reparo.ts` | `runWithRepair` genérico, generalizando `passoComCrivo` | Parte I §3.2 |
| Crivo | `motor/ciclo/crivo/criterios.ts` + `config/review-criteria.json` | Critério escrito e versionado + matriz de cenário | 8, 21 |
| Canudos | `motor/ciclo/canudos/gauntlet.ts` | Comparação cega contra referência externa concreta. **Só liga com `orcamentoPorCard` (Tesouro) ativo** | 23 |
| Reprise | `motor/ciclo/reprise/reparadores/*.ts` | Um `BuildRepairer` por domínio: laravel, go, rust, unity, godot | 6 |
| Roda/Arena/Voto | `motor/ciclo/{rda,arn,vto}.ts` | Consenso, debate e voto entre críticos do Canudos | 23 |
| Eco | `motor/tomada/eco/prefixo.ts` | Prefixo byte-idêntico entre chamadas do mesmo card. `narrowFix` **anexa**, nunca reescreve | 17 |
| Euclides | `motor/euclides/eventos.ts` | Evento por fase em JSONL: `gate_start`, `repair_attempt`, `gate_verdict`, `human_checkpoint`, `orfao` | Parte I §3.8, 27 |
| Euclides | `motor/euclides/recuperar.ts` | No restart, reconstrói a fase de cada card sem evento final | 26 |
| Radar | `motor/euclides/radar/servidor.ts` | `GET /health` + shutdown gracioso em `SIGTERM` | 30 |
| Tesouro | `config/model-tier.json` | Tier por ação, `regraDeSubida`, `orcamentoPorCard.tetoUsd` | 19 |
| Salvo-conduto | `motor/quilombo/salvo-conduto/idempotencia.ts` | `hash(card + fase + tipo_operacao)`. Grava **antes** de considerar concluída | 25 |
| Salvo-conduto | `motor/quilombo/salvo-conduto/compensacao.ts` | Saga: `pr_orfao`, `notificacao_incerta` | 27 |
| Cofre | `motor/quilombo/cofre/segredos.ts` | `EnvSecretProvider` sempre funciona; cofre de nuvem é opcional | 29 |
| Quilombo | `motor/quilombo/limites.ts` | Teto de CPU/memória por worktree paralelo | 32 |
| Cascudo | `motor/cascudo/acervo.ts` + `motor/cascudo/resolver.ts` | Loader de `SKILL.md` + fusão `_native` + `_sources` → `_resolved` | 3, 10, 15 |
| Cascudo | `skills/` + `config/skill-sources.json` | Packs: `common`, `backend-web`, `frontend-web`, `mobile`, `systems-languages`, `games-multiplatform`, `data-ml`, `devops-deploy` | 3, 7, 10, 15 |
| Freire | `motor/cascudo/freire/aprendiz.ts` | Roda 1x no fechamento. Lê o diário Euclides, **não** o código. Extrai `ProblemSignature` deterministicamente | 12 |
| Freire | `.hii/candidatos-regras/` | Acumula sem efeito no gate até N cards (default 3) | 12 |
| Lei | `motor/cascudo/lei/guarda.ts` + `config/regras-inegociaveis.json` | Guarda de risco sobre o diff. **Card pode subir o rigor, nunca baixar** | 2, 13, 22 |
| Vital | `motor/agentes/vital/auditoria-harness.ts` | Grep determinístico por prompt injection em `SKILL.md`, `mcp.json`, hooks | 14 |
| Vital | `config/security-checklist/<stack>.json` | Checklist versionado por stack | 7 |
| Chagas | `motor/agentes/chagas/red-primeiro.ts` | RED antes do GREEN obrigatório no perfil `completo` | 5 |
| Clarice | `motor/agentes/clarice/doc-updater.ts` | Docs atualizadas quando a mudança afeta contrato público | 9 |
| Rondon | `skills/_resolved/common/search-first/SKILL.md` | Procurar antes de codar | 3 |
| Embarque | `Dockerfile`, `docker-stack.yml` | Uma imagem, roda igual em VPS/AWS/Azure/GCP. **Zero SDK de nuvem no motor**. Compose e PROIBIDO (r-0001): ele ignora `deploy.resources.limits` e o teto do item 32 viraria decorativo | 28, 31, 32 |
| Mirante | `motor/mirante/comandos-manuais.ts` | `/orquestrador-{jogos,dev-web,android,devops}` + `/layout`. São **atalhos de intake**, não orquestradores novos | 16 |
| Cartório | `motor/quilombo/cartorio/aprovar-plano.ts` | Parede humana na Fase 4, antes de implementar | 4 |
| Bússola | `motor/cordel/bussola/setup-ferramental.ts` | Projeto/feature nova não avança sem teste rodando e debug documentado — Pilar 3 | 22 |

---

## 8. Os 32 itens do roadmap, por dono

| # | Item | Dono | Co-dono |
|---|---|---|---|
| 1 | Harness interface formal | **Tomada** | — |
| 2 | Guarda determinística de risco sobre o diff | **Lei** | Rota |
| 3 | `search-first` como skill de `common/` | **Cascudo** | Rondon |
| 4 | Confirmação humana do plano | **Cartório** | Lúcio |
| 5 | RED antes de GREEN no perfil `completo` | **Chagas** | Crivo |
| 6 | `BuildRepairer` por domínio | **Reprise** | Cascudo |
| 7 | Checklist de segurança por stack | **Vital** | Cascudo |
| 8 | Critério escrito pro crivo + `plugin-eval` 1-2 | **Crivo** | — |
| 9 | `doc-updater` como papel novo | **Clarice** | — |
| 10 | Pack `games-multiplatform/` | **Cascudo** | — |
| 11 | Despacho dinâmico dentro de uma fase | **Oswaldo** | Niemeyer |
| 12 | `aprendiz` + `.hii/candidatos-regras/` | **Freire** | Euclides |
| 13 | `regras-inegociaveis.json` + `rule-guard` | **Lei** | Freire |
| 14 | Auditoria do próprio harness | **Vital** | Cascudo |
| 15 | Notas de referência 2026 em cada `SKILL.md` | **Cascudo** | — |
| 16 | Comandos manuais + `/layout` | **Mirante** | Lúcio |
| 17 | Prefixo estável (anexar, nunca reescrever) | **Eco** | Ciclo |
| 18 | Blocos com validação incremental | **Tijolo** | — |
| 19 | `model-tier.json` + `orcamentoPorCard` | **Tesouro** | Rui |
| 20 | `matriz-entendimento-<card>.md` na Fase 4 | **Lúcio** | Cartório |
| 21 | Matriz de cenário no `review-criteria.json` | **Crivo** | Chagas |
| 22 | Guarda de setup ferramental na Fase 1 | **Bússola** | Lei |
| 23 | Modo `gauntlet` no crivo | **Canudos** | Roda, Voto, Tesouro |
| 24 | `topologia.json` — grafo como dado | **Niemeyer** | — |
| 25 | Idempotência em efeito colateral externo | **Salvo-conduto** | Euclides |
| 26 | Retomada de card no restart | **Euclides** | Mutirão |
| 27 | Evento `orfao` + compensação | **Salvo-conduto** | Euclides |
| 28 | `Dockerfile` + `docker-stack.yml` | **Embarque** | — |
| 29 | `secrets.ts` com `EnvSecretProvider` | **Cofre** | — |
| 30 | `GET /health` + shutdown gracioso | **Radar** | Mutirão |
| 31 | Snapshot do volume + git | **Embarque** | Alicerce |
| 32 | Limite de CPU/memória por worktree | **Quilombo** | Mutirão |

Cobertura: **32/32 itens têm dono nomeado.** Nenhum código da taxonomia ficou sem trabalho, e nenhum item ficou órfão.

---

## 9. Regras de nomenclatura

Para quem for adicionar um componente novo depois deste documento.

1. **Referência → comportamento, nunca fama.** Se você não consegue escrever uma frase que ligue a pessoa/conceito ao que o módulo *faz*, o nome está errado. Teste: "X → \<comportamento\> → \<papel\>", como em `Vital Brazil → soro específico contra veneno específico → agente de segurança`.
2. **Código de 3 letras maiúsculas, único, sem colisão de prefixo de 2 letras** com código do mesmo domínio (§10).
3. **Todo código precisa de âncora.** Arquivo real ou marcação `NOVO` com item de roadmap. Código sem âncora não entra na tabela.
4. **Pasta = domínio, arquivo = código.** `motor/<dominio>/<codigo>/<arquivo>.ts`. Subpasta só quando o código tem 2+ arquivos.
5. **Idioma: português.** O motor já é escrito em português (`preferencias`, `disponibilidade`, `podar-registros`). Símbolo novo segue.
6. **Nada vira modo.** Componente novo é módulo dentro do pipeline único. Se a proposta cria um "modo de operação" paralelo, ela está errada — é o modo de falha nº 1 documentado no `MODERNIZATION.md` (Parte III, Princípio 1).
7. **Se o comportamento é determinístico, o nome não pode sugerir julgamento de modelo.** `Lei` cobra; `Crivo` julga com critério escrito; `Canudos` julga contra referência externa. Os três são coisas diferentes e os nomes têm de manter isso separado.

---

## 10. Colisões e códigos reservados

Colisões de prefixo de 2 letras que **existem** e foram avaliadas como aceitáveis por viverem em domínios diferentes:

| Par | Códigos | Domínios | Por que passa |
|---|---|---|---|
| `AL` | Alfândega (Alfândega) / Alicerce (Alicerce) | `quilombo/` vs `cordel/alicerce/` | Fronteira de entrada vs. fundação de ambiente. Nunca no mesmo import |
| `RD` | Roda (Roda) / Radar (Radar) | `ciclo/` vs `euclides/radar/` | Consenso entre críticos vs. telemetria |
| `RT` | Rota (Rota) / Retirada (Retirada) | `oswaldo/rota/` vs `ciclo/` | Router vs. fallback |
| `TS` | Tarsila (Tarsila) / Tesouro (Tesouro) | `agentes/tarsila/` vs `euclides/tesouro/` | Agente criativo vs. governança de custo |
| `VT` | Vital (Vital) / Voto (Voto) | `agentes/vital/` vs `ciclo/` | Agente de segurança vs. seleção entre alternativas |

Cinco colisões de prefixo de duas letras, todas entre domínios diferentes — nenhuma pode aparecer no mesmo `import`. Verificação mecânica (deve imprimir exatamente estes cinco pares):

```bash
# lista todo par de códigos que compartilha as duas primeiras letras
cut -c1-2 codigos.txt | sort | uniq -d
```

**Códigos rejeitados durante o desenho**, registrados para não voltarem:

| Rejeitado | Motivo |
|---|---|
| `BND` — Bandeira (unidade de trabalho) | Bandeirantes carregam associação histórica com escravização indígena. Trocado por `Cordel` — Cordel |
| `ENG` — Engenho (fila/daemon) | Engenho carrega associação com trabalho escravizado. Trocado por `Mutirão` — Mutirão |
| `CDN` — Caderneta (card) | Colide visualmente com `Canudos` — Canudos |
| `CRT` — Carta (regras) | Colide com `Crivo` no par `CR` dentro do mesmo eixo de julgamento. Trocado por `Lei` |
| `PTR` — Porteira (parede humana) | Colide com `Portinari` — Portinari. Trocado por `Cartório` — Cartório |
| `FRT` — Fronteira (entrada externa) | Redundante com `Alfândega` — Alfândega, que já é a metáfora certa para inspeção de entrada |

**Reservados, ainda sem uso** — não atribuir a outra coisa: `Rui` (estratégia, ativa só na Onda 9), `Arena` (debate, ativa só se Canudos precisar), `Drummond` (deep reasoning, hoje é tier em Tesouro e não módulo).

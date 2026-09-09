# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

**Podado em 29/08/2026, e podado de novo no mesmo dia** conforme as ondas saíram. Saiu daqui tudo o que foi conferido no código como feito:
as ondas D–H e as três rodadas de crivo, o roadmap dos 34 itens, `truncVisible`
(razão 417× → 0,98×, com teste de razão por tamanho de entrada em
`test/mirante/tui-sob-carga.test.ts:110-130`), a migração da suíte para `node:test`, a
evidência de RED pela opção 2, e os itens 1, 2 e 4 da ordem de corte de custo. O que
restou abaixo foi reconferido arquivo por arquivo — cada seção diz onde está a prova.

**Podado de novo em 02/09/2026**, depois de reconferir cada item aberto contra o código.
Saíram: o teto por teste da trilha bun e o isolamento dos testes sensíveis a carga na
trilha node (as duas trilhas passam a declarar o mesmo número, guardado por
`test/cordel/tetos-das-trilhas.test.ts`); `status_since` e `halt_class` obrigatório, com
as 33 escritas de `HALTED` classificadas e consumidor em `lerSaudeDoMotor`
(`test/cordel/parada-com-classe-e-idade.test.ts`); o backoff por classe de espera
(`test/ciclo/backoff-por-classe-de-espera.test.ts`); e o `HICODE_RIGOR_ESTRITO`, ligado
em `docker-stack.yml`. Três afirmações desta lista estavam **vencidas** e foram
corrigidas onde aparecem: a medição de custo, o card 006 e o aviso sobre o item 5.

---

## RECOMENDAÇÃO — onde o dinheiro queima, agora medido no ledger e não estimado

Os itens 1, 2 e 4 da ordem de corte anterior entraram no PR #28 e saíram desta lista.
O que sobrou é o item 3 — e a medição abaixo, que não existia quando a ordem foi
escrita, muda a prioridade dele de "quando der" para "primeiro".

> **Medição vencida, reconferida em 02/09/2026.** Os números abaixo não reproduzem mais:
> somando `cards/runs/*.ias.jsonl` hoje dá **9 chamadas, US$ 6,13** (implement 4,01 ·
> ideação 1,00 · step 0,69 · gate 0,44). Os ledgers dos cards 003–006 foram apagados do
> disco, e **o card 006 não existe mais** — `cards/` tem só 001 e 002. A tabela fica como
> registro do que foi medido, não como linha de base: quem for otimizar o gate **precisa
> remedir antes**, porque com uma única chamada de gate no ledger a conclusão sobre
> consumo de contexto não é mais verificável.

**Somando todo `cards/runs/*.ias.jsonl` em disco: 27 chamadas, US$ 19,80** (medido em 29/08).

| papel | n | US$ | % do custo | tokens de cache | tokens de saída | segundos |
|---|---|---|---|---|---|---|
| `implement` | 4 | 7,70 | 39% | 205.888 | 68.633 | 1.070 |
| `step` | 11 | 7,13 | 36% | 311.232 | 56.363 | 862 |
| `gate` (crivo) | 9 | 4,47 | 23% | **640.015** | 74.920 | 993 |
| `clarify` | 2 | 0,32 | 2% | 75.045 | 719 | 26 |
| `avaliacao` | 1 | 0,19 | 1% | 44.845 | 141 | 11 |

**Card 006 sozinho custou US$ 15,94 e está em `URL` desde 25/08, sem entregar.** O
teto por card é US$ 16 (`config/model-tier.json`): ele parou a seis centavos do teto
sem que o teto tivesse nada a ver com isso. É a prova mais direta de que hoje se gasta
sem acertar — e o motivo de "acertivo" vir antes de "barato" na ordem de trabalho.

**O crivo é o maior consumidor de contexto do repositório, com folga.** 640 mil dos
1,28 milhão de tokens de cache de toda a história saem de 9 chamadas — ~71 mil tokens
lidos por chamada para produzir ~8 mil de saída. A causa está em
`motor/ciclo/crivo/gate.ts:165` (`buildPrompt`): o crivo revisa o **diff acumulado** da
branch inteira contra a base (`:122`, range `origin/<base>...HEAD`, teto
`GATE_DIFF_LIMIT` = 60.000 caracteres em `motor/cordel/alicerce/config.ts:68`) a **cada passo
gated**. Com quatro passos, o mesmo diff é lido quatro vezes, e cada leitura é maior
que a anterior — o custo do gate cresce com o quadrado do número de passos.

Rever o acumulado é escolha deliberada (pega regressão que o passo isolado esconde) e
não deve ser trocada às cegas por diff incremental. O que dá para fazer sem perder
isso: mandar o **incremental do passo** como corpo e o **acumulado só como lista de
arquivos** (`diff.names`, que já é calculado em `:123` e truncado em 4.000 caracteres),
deixando o crivo pedir o trecho acumulado quando a lista indicar sobreposição. Antes de
mexer, medir: o número acima é a linha de base.

**R: aplicado em 09/09, com um achado que muda o desenho.** O que dava para ligar sem
remedir, ligou: `esforcosPorTier` entrou na governança (`tier3_barato: low` — limpeza,
documentação, classificação e avaliação deixam de pagar raciocínio profundo; nenhum custo
sobe), com `esforcoGovernado` na mesma precedência do modelo: humano > dado versionado >
padrão do harness, e tier elevado saindo do assento barato. **O assento barato ENTRE
provedores (tier3 → ollama) está fechado pelas guardas do próprio motor:** ollama é
`agentic: false` (não pode editar em step) e `emitsStructuredJson: false` (recusado onde o
veredito é JSON — crivo, avaliador, visual). Não é esquecimento: mapear o ollama hoje
faria o passo falhar na guarda, não economizar. Abrir esse assento exige ou um harness
ollama agentic, ou um leitor de veredito tolerante a JSON solto — os dois são trabalho
novo, registrados aqui.

**O corte de contexto do crivo aguarda a remedição que esta própria seção exige:** com
uma única chamada de gate no ledger atual, a conclusão dos 640k tokens não é verificável.
O desenho está pronto (incremental do passo como corpo, acumulado só como lista de
arquivos); rodar dois ou três cards reais repõe a linha de base e o corte sai com
antes/depois medido.

**O que era o item 3 original:**
`config/model-tier.json` mapeia **ação → tier** e não tem uma linha ligando tier a
provedor, modelo ou esforço. `motor/oswaldo/rui.ts:50,62` (`tierDoCard`/`registrarTier`) tem
consumidor apenas em `motor/quilombo/cartorio/fechar.ts:214,353`, e lá só emite evento de diário:
o tier é auditado e não roteia gasto nenhum. `providerFor`/`modelFor`/`effortFor`
(`motor/tomada/registro.ts:59,116,120`) decidem por `preferenciaDoPapel` + variável de
ambiente, sem olhar tier.

O material para decidir já está na máquina: os quatro provedores estão instalados
(`claude`, `codex`, `kimi`, `ollama`), e o `ollama` local tem `qwen3-coder:30b` — que
custa US$ 0,00 em dólar e tempo de GPU em vez de token. As 27 chamadas medidas foram
**todas** em `claude`. Escrever o mapa `tier → (provedor, modelo, esforço)` no arquivo
de governança é o que falta; ligar `providerFor`/`modelFor`/`effortFor` ao tier já
computado é trabalho pequeno depois disso.

R: Pode fazer.

---

## ESTADO — o que o motor não consegue ver quando um card para

Três achados de diagnosticabilidade, que explica por que card 001 em `URL` há 4 dias não grita e card 002
em `HALTED` não diz por quê. O script que responde `/health` faz `lerSaude()` → `{"ok":true,"encerrando":false,"emVoo":0,"pendentes":0,"falhasSeguidasNoTick":0,"ultimoErro":""}` porque
`recordTickSuccess()` zera o contador de falhas sempre que o `tick` não lança exceção — mesmo que nenhum
card tenha mudado de estado. Não há campo que meça "ciclos improdutivos seguidos".

**Os dois primeiros saíram em 02/09.**

`halt_class` era escrito em 2 sítios e ~26 `HALT` cravavam `status: HALTED` sem classe.
Agora as **33 escritas de `status: 'HALTED'` do motor carregam classe**, com vocabulário
próprio e mais largo que `FailureClass` (`CLASSES_DE_PARADA` em `motor/cordel/tipos.ts`:
`transient`/`quota`/`terminal` para falha de chamada de IA, mais `orcamento`, `escopo`,
`humano`, `excecao`, e a sentinela `nao_classificado`). O invariante não depende de
ninguém lembrar: `motor/cordel/store.ts` é o ponto de estrangulamento e carimba a
sentinela **com linha de diário dizendo DEFEITO** quando a escrita chega sem classe —
sentinela silenciosa seria pior que campo ausente, porque pareceria classificação. O
mesmo ponto preenche `halt_at` e extrai `halt_reason` da linha de diário
(`<iso> <origem>->HALTED <motivo>`), o que dispensou repetir o motivo nos 33 sítios.
`motor/mirante/acoes.ts` deixou de usar `transition` no `halt()`: parada pedida por
pessoa é `humano`, e era indistinguível de parada por cota no frontmatter.

`status_since` não existia. Agora é gravado **só quando o status muda**, no mesmo ponto
de estrangulamento, e semeado em `createCard` — sem semente, card nenhum teria idade até
a primeira transição, que é exatamente a janela em que ele espera alguém. `updated`
continua sendo reescrito em todo `patchCard`, de propósito: não foi ele que mudou.

O consumidor está em `lerSaudeDoMotor` (`motor/euclides/radar/saude.ts`), sem o qual os
dois campos seriam decorativos: `paradas[]` (toda parada, de qualquer classe, com motivo
e idade) e `esperandoVoce[]` (os estados sem consumidor automático, com idade a partir de
`status_since`). E `estado` ganhou `'parado'` — era aqui que o card 002 sumia da leitura
inteira e o motor respondia `ocioso` com card travado. `provedoresIndisponiveis` continua
vendo só `quota` e `transient`, correto: é mapa de indisponibilidade de **provedor**, e
parada por orçamento ou escopo não pertence a ele.

Os campos `desde`/`desdeConhecido`/`idadeMs` seguem o padrão de `provedorIdentificado`:
card gravado antes desta mudança não tem idade mensurável, e devolver zero afirmaria
"parou agora". Leia o booleano antes do número.

**O que continua aberto aqui:** `isActive()` (`motor/mirante/render/phases.ts:34-36`)
ainda não inclui os estados sem consumidor, então a TUI segue sem coluna de tempo —
o dado existe agora, falta quem o desenhe.

O tipo `'human_checkpoint'` de evento existe em `TIPOS_DE_EVENTO` (`motor/euclides/eventos.ts:19`) e é citado
como implementado em docs, mas **grep encontra zero emissores** de `anexarEvento` com esse tipo. `checkpointsHumanos`
em `config/topologia.json:74` está tipado e parseado, com zero consumidores de produção. Nada sabe que
`URL` *é* checkpoint, nada pode ter timeout.

**Sinal que falta, em ordem de impacto** (os itens 1 e 2 saíram em 02/09 e estão descritos acima):

3. **Saiu em 09/09** — `human_checkpoint` é emitido no estrangulamento (`updateCard`):
   entrada em checkpoint gera `aberto`, saída gera `atendido`, dado vindo de
   `checkpointsHumanos` na topologia (que ganhou `CLARIFY` e `PAUSED` — três dos quatro
   checkpoints reais estavam fora da lista). Falha ao gravar o evento não falha a
   escrita do card.
4. **Saiu em 09/09** — assinatura da fila comparada por tick; `ticksSemProgresso` em
   `DaemonHealth` (sobrevive a `recordTickSuccess`, que era o furo), e `/health` responde
   `ok:false`/503 com o motor de pé e improdutivo por `HICODE_TICKS_SEM_PROGRESSO_MAX`
   ticks (6 por omissão). De quebra: job que volta SEM mudar o status entra em cooldown
   (`HICODE_CARD_COOLDOWN_MS`, 30 s) — o redespacho em 5 s que virava laço de gasto.
5. Campo `diffHash` + `criterio` do veredito em evento `gate_verdict` — `motor/ciclo/passo-com-gate.ts:114`,
   com `chave: diffHash` do diff acumulado (`motor/ciclo/crivo/gate.ts:131`). Três vezes o mesmo hash =
   laço comprovado, não inferido.
6. Agregador de histórico por harness (taxa de falha por classe, latência p95) — varredura de
   `motor/euclides/tesouro/cota-runs.ts` que já faz `loteDesde()` estendida a agrupar por `provedor`.
   Base para o roteador (PLANO acima) ter memória observada.
7. `/health` checando card preso em checkpoint — teto de dias em aberto sem sinal de progresso.

Dois itens adicionais para o operador diagnosticar à mão, hoje invisíveis:

- `hii doctor` não olha card — `motor/euclides/radar/doctor.ts:196-203` pula de checagem de ambiente direto para
  daemon. Quando um card parou, o doctor responde tudo verde e deixa o humano sem pista.
- Drenagem incompatível — `motor/oswaldo/mutirao/encerramento.ts:11` (`HICODE_SHUTDOWN_TIMEOUT_MS`=30 s) contra
  `motor/cordel/alicerce/config.ts:48` (`RUN_TIMEOUT_MS`=900 s). SIGTERM durante agente mata o filho; custo da
  passagem nunca é escrito, portão de orçamento funciona com número subconta.

**O que fica em aberto:**

Timeout automático de checkpoint humano — nenhuma das referências abertas (OpenRouter, Claude Code Agent
SDK, OpenCode) documentam escalação automática por timeout. Falta decisão de produto. Enquanto não houver,
o sinal de "aberto há quanto tempo" (item 1 acima, `status_since`) habilita alertas manuais.

Reaper de `url_pid` e worktrees órfãs — já foi mencionado em PENDENCIA acima. Trata-se do mesmo padrão:
reconferir saúde de recurso que foi delegado e nunca se verifica depois.

---

## PENDÊNCIA — comandos nativos por provedor: sem mescla e sem namespace

O que sobrou do revezamento (os quatro itens do R: saíram em 09/09 — sessão por card,
bastão com autoria, escolha no motor, e o fallback superado pelo roteador):
`motor/tomada/mapa/comandos.ts` enumera manifestos `.md` por provedor, mas
`comandosDaIaAtiva` olha só `providerNameFor('implement')`, nunca mescla provedores, e
não tem namespace — o dedup é um `Set` dentro da lista de um provedor só. `ollama` não
tem entrada em `FONTES`, e não está decidido se é lacuna ou escolha. O precedente de
namespace existe: `MCP_PREFIX` em `motor/tomada/ponte/mcp.ts`.

---

## ESTADO — a costura entre o motor e a TUI, e as três coisas chamadas sessão

Levantado por varredura de import sobre `motor/`, `bin/`, `test/` e `runner.ts`, com o resultado
conferido arquivo por arquivo pelo crivo. **O núcleo importa da TUI: 21 arestas, em 14 arquivos.**
A dependência está invertida, e não é um caso isolado — é o padrão. Alguns exemplos que mostram o
tamanho do problema: `motor/ciclo/agente.ts:2` e `motor/quilombo/cartorio/fechar.ts:2` puxam
`objetivoComInstrucoes` de `mirante/instruir.ts`; `motor/ciclo/crivo/url-viva.ts:7` puxa `devCommand` e
`devCwd` de `mirante/comandos.ts`; `motor/euclides/radar/progresso.ts:13` puxa `PHASES` de
`mirante/render/phases.ts`; e `motor/tomada/mapa/comandos.ts:5` puxa `stripAnsi` de `mirante/tui/layout.ts` —
a camada de **provedor** dependendo de renderização de terminal.

O que a varredura mostrou e que muda o diagnóstico: **cinco arquivos de `mirante/` não são TUI coisa
nenhuma.** `mirante/acoes.ts` (a API de escrita de card), `mirante/instruir.ts`, `mirante/comandos.ts`,
`mirante/progresso.ts` e `mirante/historico.ts` importam só de `cordel/`, `quilombo/`, `tomada/eco` e `euclides/tsr` — e
`grep -c $'\x1b'` devolve zero nos cinco. É motor puro morando no endereço errado. A inversão,
portanto, não é acoplamento a ser cortado: é **domínio que precisa mudar de casa**.

**Não há ciclo de import a desfazer.** Tarjan sobre o grafo completo devolve exatamente dois
componentes fortemente conexos, e nenhum deles atravessa a fronteira: `mirante/render/execucao.ts` ↔
`mirante/atividade.ts`, e `oswaldo/mutirao/encerramento.ts` ↔ `oswaldo/mutirao/estado-da-fila.ts`. No nível de módulo a
inversão é bidirecional com sete módulos, mas no nível de arquivo dá para reordenar à vontade sem
risco de deadlock de import.

**O que já serve de contrato entre os dois lados** e não precisa ser inventado: `motor/euclides/eventos.ts`
é o barramento (`TIPOS_DE_EVENTO` fechado em 11 tipos, `:13-28`; `anexarEvento` append-only em
`cards/runs/<card>.eventos.jsonl`), `motor/cordel/store.ts` é o estado compartilhado, e
`motor/euclides/radar/servidor.ts` já expõe `/health`. Falta uma coisa só, e é notificação: hoje a TUI
descobre mudança por `fs.watch` em `mirante/watch.ts`. Para a TUI virar cliente do motor, isso basta.
O que **não** existe é um tipo único de fronteira: o estado do motor para quem desenha está partido
em `SnapshotDoMotor` (`mirante/estado-json.ts:64`, com `VERSAO_DO_CONTRATO = 1` em `:22` — o contrato de
saída do motor escrito dentro da TUI), `EstadoDaConfig` (`mirante/render/config/tipos.ts:57-70`) e
`SaudeDoMotor` (`euclides/radar/saude.ts`, esse já no núcleo).

### Sessão são três coisas diferentes com o mesmo nome

1. `motor/euclides/sessao.ts` — 18 linhas, `let atual = ''`, id `<timestamp>-<pid>`. **Sessão é o processo.**
2. `motor/euclides/ias-da-sessao.ts` — `abrirSessao`, `registrarChamada`, `agregarPorIa`, `trocasDeProvedor`.
   **Sessão é um ledger append-only por execução**, em `cards/runs/<sessao>.ias.jsonl`.
3. `motor/mirante/sessao.ts` — `SessionState` (`:10-26`) e `handle` (`:245`). **Sessão é estado de tela.**

A ponte entre a primeira e a segunda é uma concatenação de string:
`sessaoParaChamada(id)` devolve `sessaoDoCard(id)` quando há card, e `conversa-<sessaoAtual()>` quando não há —
`motor/euclides/tesouro/confianca.ts:84-86`, consumida por `motor/cordel/alicerce/snapshot.ts:132`.

**O que fazer, e onde.** A fronteira é: núcleo = tudo menos `mirante/`, mais os cinco arquivos acima;
interface = `mirante/render/`, `mirante/tui/`, `mirante/cli/`, `despacho.ts`, `sessao.ts`, `responder.ts`,
`completar.ts`, `watch.ts`; composição = `bin/hii.ts`, `bin/repl.ts`, `runner.ts`.

**O que fica em aberto — e por que não há plano de movimentação aqui.** A sequência de passos que
moveria esses arquivos foi escrita três vezes e **reprovada nas três** pelo crivo, sempre por
obstáculo real, nunca por preciosismo. Os três obstáculos, para quem for tentar de novo:

- `renderProgress` é importado por `runner.ts:3` e chamado em `:43`. Movê-lo para o lado da interface
  faz o entrypoint headless depender da apresentação — o oposto do objetivo.
- `test/mapa-de-rename.test.ts` e `scripts/renomear-brazil.mjs` **travam o mapa de arquivos**. Há um
  `TOTAL_ESPERADO` e um mínimo por domínio (`mir` ≥ 57, com 62 em disco: cinco de folga), mais uma
  exigência de injetividade. Metade dos passos propostos deixava a suíte vermelha.
- `PHASES` carrega `color: '\x1b[...'` (`mirante/render/phases.ts:8-13`). Movê-lo verbatim põe ANSI no
  núcleo e quebra o próprio invariante que a separação existe para criar. O campo tem um único
  consumidor (`euclides/radar/progresso.ts`), que vai para o lado da interface de qualquer forma — então o
  certo é o campo sair do tipo, não viajar junto.

Mover arquivo neste repositório é caro por decisão de projeto, e o mapa de rename é a razão. Quem
retomar isto começa por aí, não pelo grafo de imports.

---

## PENDÊNCIA — a fita grava um degrau acima de onde o defeito mora

Os quatro consertos e o rename saíram em 09/09 (PR #36). Ficam os dois itens de desenho:

- A fita envolve `Harness.run`; gravar stdout/stderr/exit-code do **subprocesso**
  exercitaria o parser de cada harness de verdade — foi num parser que o argv errado do
  kimi sobreviveu verde. Custo: uma costura por harness.
- O motor não tem como receber o harness envolvido: o registro é `ReadonlyMap` const e
  os chamadores resolvem por `providerFor()` internamente. A costura de percurso real é
  `ExecuteDeps`.

---

## ESTADO — o que ficou aberto nas duas trilhas de teste

`bun run test` passa inteiro desde 02/09 — `EXIT=0`, 2767 pass na trilha bun e 2761 na
node, zero fail. **Não passava** quando esta seção foi escrita, e a seção afirmava que
passava: dois defeitos de infraestrutura de trilha derrubavam o gate local e saíram nesta
rodada.

O primeiro era o **teto por teste**: `bun test` corta em 5.000 ms por padrão e a trilha
bun nunca declarava outro, enquanto a node declarava `--test-timeout=60000` — 12x de
diferença. Com a piscina cheia, os dois arquivos que sobem subprocesso estouravam
(`import-com-extensao` em 5.108 ms, `percurso-completo` em 7.330 ms) e passavam sozinhos
em 1,2 s e 3,2 s.

O segundo era o **isolamento dos sensíveis a carga**. `scripts/test-bun.mjs` já rodava
`tempo-de-pintura` e `tui-sob-carga` por último e sozinhos desde 29/08; a trilha node
não, e `node --test` paraleliza por padrão. Observado aqui: `quadro 50x200 levou 14,3 ms,
teto 8 ms` com load average 11, e **seis rodadas verdes do mesmo código** com load 5,6.
Agora `test:node` tem duas invocações — a piscina, e os sensíveis a carga com
`--test-concurrency=1`. `test/cordel/tetos-das-trilhas.test.ts` reprova se as duas
trilhas divergirem no teto ou no conjunto isolado.

O que continua aberto:

- **75 arquivos de teste escrevem `process.env` no topo do módulo** (124 ocorrências).
  O isolamento por processo — um processo por arquivo nas duas trilhas — as torna
  inofensivas, **não corretas**. Se algum dia a suíte rodar em processo compartilhado,
  elas voltam a morder. Exemplos: `test/mirante/tui-sob-carga.test.ts:15`,
  `test/mirante/tempo-de-pintura.test.ts:29-31`.
- **Duas asserções ainda medem milissegundo absoluto**: `test/mirante/tempo-de-pintura.test.ts:29-31`
  (`TETO_QUADRO_MS`, `TETO_QUADRO_CJK_MS`, `TETO_PINTURA_MS`) e
  `test/mirante/tui-sob-carga.test.ts:15` (`TETO_MS`). As duas já convivem com asserções
  por **razão** nos mesmos arquivos, que é a forma estável. **Deixaram de derrubar o
  gate** em 02/09, porque as duas trilhas agora as rodam sozinhas — mas a asserção
  continua absoluta, então ainda reprova sob carga externa (outro processo pesado na
  máquina, que o isolamento da suíte não controla). Trocar por razão é o conserto de
  verdade; o isolamento só tirou a suíte de ser a causa da própria carga.
- **`.bun-version` pede 1.4.0**: rodar com outra versão faz
  `test/cordel/scripts-existem.test.ts` acusar, por desenho. O pino é do CI
  (`ci.yml:20-22`) e existe porque `expect([NaN]).toContain(NaN)` passa no bun 1.3.14
  (SameValueZero) e falha no 1.4.0 (`===`).

---

## ESTADO — mecanismo pronto sem consumidor, por decisão

Não são pendências: são escolhas registradas para não parecerem esquecimento.

**Item 18 (`executarEmBlocos`).** O laço de `motor/quilombo/cartorio/fechar.ts` já faz
executa → valida → para cedo. Rotear por Tijolo ali é cerimônia. O valor real —
fatiar uma implementação em blocos validados — exige fatiador determinístico por
stack, que pertence à camada de skill, não ao `core/`.

---

## PENDÊNCIA — o Macunaíma diverge, mas ninguém ainda gasta token com ele

A Onda 12 entregou o mecanismo completo e ligado ao plano: `valeDivergir()` decide,
e a flag aparece em `buildPlan()` para o humano ver antes de aprovar. O que **não**
existe é o consumidor que de fato despacha os ramos contra um provedor de IA —
`despacharDivergencia()` recebe o despachante injetado, e hoje só os testes o
passam.

Isso é escolha, não esquecimento: o despachante é injetado justamente para o
isolamento ser verificável sem rede, e ligar o provedor de verdade é uma decisão
de custo (N ramos multiplicam por N) que merece ser tomada olhando o gasto real
por card, não junto com a entrega do mecanismo.

Onde mexer: `motor/agentes/clarice/clarificar.ts:77` já chama `idear()` do Tarsila no
`CLARIFY`. É o ponto onde o Macunaíma substitui o Tarsila — mesma fase, com isolamento real
entre ramos e crítico separado.

**Uma ressalva desta rodada, para quando você for ligar:** o teto por ramo
(`porRamoUsd`) deixou de ser decorativo — chega ao ramo em `Ramo.tetoUsd` e o
estouro sai nomeado em `ramosQueEstouraram`. Mas é **post-hoc**: nenhum ramo é
abortado no meio, e estouro não vira HALT. Com o despachante de verdade ligado,
isso quer dizer que o dinheiro do ramo que estourou já foi gasto quando o relato
aparece. Abortar exige o despachante cooperar (passar o teto ao provedor, ou cortar
por timeout), e isso é decisão de quem ligar.

R: aguardar eu verificar na pratica

---

## DECISÃO PENDENTE — virar provedor de IAs e cobrar por isso

Registrado porque muda o alvo do motor, e **estacionado por decisão do dono**: primeiro
fazer funcionar, depois pôr preço.

**O bloqueio é contratual antes de ser técnico.** Os harnesses conectados hoje são
CLIs autenticadas por assento, com a conta de quem roda. Assinatura por assento não dá
direito de revender acesso; cobrar de terceiros por trabalho que passa pela sua sessão
do `claude` é o tipo de coisa que encerra conta. Vender exige acesso comercial por API
com direito de uso para terceiros. Isso se resolve fora do código e vem antes de
qualquer arquitetura.

**São dois produtos, e o hii hoje é só um.** O motor de execução precisa do repositório
do cliente, do git, do `gh` e de servidor de desenvolvimento — roda na máquina dele. Um
roteador de IAs que se cobra por token roda no seu servidor, multi-inquilino, sem tocar
em repositório nenhum. Compartilham o roteador e quase nada mais. Mover a execução para
o servidor obrigaria a hospedar código-fonte e credencial de terceiro, que é
responsabilidade maior do que a que se queria evitar.

**A convergência que vale notar:** o requisito de trocar de IA no meio do prompt e o
objetivo de cobrar pedem a mesma peça — um harness por **API** ao lado dos de CLI. Com
o histórico na mão (e não dentro de um binário opaco), a troca no meio da tarefa deixa
de ser handoff por bastão escrito e vira o que a `PENDÊNCIA` sobre revezamento diz hoje
ser impossível. E a medição por token, que a cobrança exige, passa a existir de verdade
— hoje `codex` e `kimi` declaram `reportsCostUsd:false` e não têm o que medir.

**O que não existe e o produto exigiria:** inquilino (não há conceito de usuário),
medição por cliente (há por card, em `AgentResult` e no ledger de
`motor/euclides/ias-da-sessao.ts` — a matéria-prima existe), cota por cliente
(`motor/euclides/tesouro/orcamento.ts` tem teto por card) e limite de taxa.

**Sobre proteger o código, que foi a pergunta de origem:** se o produto virar uma API
medida, o cliente nunca recebe fonte e o servidor é a fronteira natural. Enquanto o
produto for o motor local, o caminho barato é compilar — o Bun gera executável único —
e não subir servidor nenhum.

R: MANTER: primeiro fazer funcionar, depois pôr preço
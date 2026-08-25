# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## FEITO — Ondas D a H (as respostas em R: desta rodada)

Tudo o que estava respondido com `R:` foi aplicado. O que sobrou está nomeado nas
seções abaixo, com o porquê.

| Frente | O que foi feito |
|---|---|
| Step `review` sem `gated` | **Removido do pipeline.** `runCodefoxGate` no fecho já faz a revisão adversarial LENDO o diff; o veredito do step nunca era lido e ele custava uma chamada de agente com escrita habilitada. O tier `review` de `model-tier.json` passou a ser registrado pelo gate do fecho — senão viraria config morta |
| Gauntlet substituindo o critério escrito | **Interruptor explícito na TUI**: `/gauntlet on\|off\|toggle` (apelido `/crivo`), estado visível na linha de propriedades junto com as ias. Desligado por omissão — antes, um card de pack visual com imagem anexada saía do pipeline sem NENHUMA leitura de código. O `tetoUsd` de `podeIniciar()` deixou de ser decorativo: o modo recusa iniciar se o card já gastou o teto |
| `auditoria.ts` monolito (402 linhas) | **Dividido** em `tipos/cobertura/metricas/plano/relato`, com `auditoria.ts` virando reexport de 17 linhas. Uma ferramenta de auditoria que se isenta do próprio critério não vale como critério |
| Guardas que não podiam falhar | Topologia por **par (origem, destino)** conferido no ponto de escrita do card (`motor/nmy/deriva-de-transicao.ts`) — a varredura por destino não podia reprovar nada, e o motor executava 17 transições não declaradas. Idempotência pelo lado do **efeito** (toda invocação de `gh` que muta). Prefixo em `mapa-de-comandos`. `indexOf` sem guarda do `-1` em `retomada-no-arranque` e `tui-fluxo`. Asserção sobre texto-fonte em `vtb-checklist`, `escolher-ia`, `bss-setup-ferramental`. `not.toContain` de string inexistente em `comandos-de-modelo`, `board`, `tui-layout`. Fórmula repetida em `mcn-divergir` |
| Produção | `HICODE_HEALTH_HOST` × `HICODE_HEALTH_BIND` unificados, os dois no contrato de ambiente, e três guardas novas: toda `HICODE_*` do Dockerfile tem de estar no contrato, e `EXPOSE` exige bind coerente. Comentário do `docker-stack.yml` e do `limites.ts` passaram a citar o consumidor real |
| Silenciamento | `git merge` nomeia a causa (conflito × mudança local × `index.lock` × ref inválida) lendo stdout **e** stderr. `gh` propaga falha e o `hii sync` sai != 0. MCP separa "não consegui listar" de "não existe" (e a primeira é transitória, não HALT). `package.json` e `contract.json` corrompidos avisam em vez de virar "ausente". `ia.json` corrompido avisa. Ledger de custo que falha grita. `ollama` leva `j.error` para `detail` (sem isso `OLLAMA_SINAIS.terminal` era inalcançável). `executar.ts` separa "repo sem dev server" de "dev server não subiu". `recuperar.ts` fecha TODAS as fases abertas, e por par abertura/fechamento |
| TUI | Colagem recuperada do histórico volta expandida (o histórico guardava o marcador e `pastes` era zerado no mesmo passo). Linha maior que o terminal ganhou **rolagem horizontal** (`janelaHorizontal`): o texto sob o cursor fica visível e `cursorCol` nunca passa da largura |
| Valor calculado e nunca aplicado | `porRamoUsd` chega ao ramo e estouro sai nomeado · `Plan.divergencia` renderizado · `tetoUsd` do gauntlet aplicado · `tetoUsd` do painel passou a ser o **mesmo** que o motor barra (lia `HICODE_BUDGET_USD`, que nada mais escreve) · `taskSyncNames` virou validação de `HICODE_TASK_SYNC` · `modoResolvido` no rodapé · `FonteDeSkills.ativa` desliga a origem de verdade · `ehAreaNova` com a regra certa e usada no fecho · `readProjectConfig` virou checagem de divergência no `doctor` · `placar()` removida (era reexport de `contar()` sem consumidor) |
| Defeitos da própria auditoria | `comandos-manuais.ts` agora é chamado no arranque (o comentário afirmava isso e só o teste chamava) · shebang de `bin/hii.ts` virou `node`, o runtime da imagem · `convergir.ts` não coage `true`/`[1]` em voto na primeira proposta · `origem` das regras inegociáveis ganhou tipo e validação (estava no plano mestre, no JSON e em guarda nenhuma) · `docker-compose.yml` virou `docker-stack.yml` no plano mestre, com o motivo |

A memória do erro de verificação (sondar `/health` de dentro do container e
concluir alcance externo) ficou registrada fora do repo, como pedido.

### E depois o `/verificar` achou defeito no próprio conserto

A auditoria rodou sobre a **superfície desta branch** (107 arquivos em 12 lotes,
`crivo` adversarial por lote) e voltou com defeito real no que eu tinha acabado de
escrever. Vale registrar, porque é o argumento de existir do gate:

| Achado da verificação | Onde |
|---|---|
| **Crash no caminho que o conserto criou.** O tratamento novo de falha da listagem MCP zerava o cache ANTES do closure lê-lo: `await consulta.servidores()` dava `undefined` e estourava `TypeError` — exatamente no caso que o tratamento existia para cobrir, e a exceção subia até o card fazer HALT sem retry | `motor/tmd/pnt/mcp.ts` |
| **Segundo teto de orçamento.** A trava nova do gauntlet comparava o gasto contra `model-tier.json` direto, ignorando `HICODE_CARD_BUDGET_USD` — o "teto lido de duas fontes" que o invariante do repo proíbe. O invariante não viu porque a lista de adotantes estava incompleta; agora há varredura que exige registro | `motor/cic/cnd/gauntlet.ts` |
| **Rolagem horizontal desalinhada + off-by-one.** O deslocamento em colunas era passado no parâmetro da coluna do cursor, então cada linha rolava por conta própria (com o comentário afirmando o contrário); e sem moldura o `cursorCol` chegava a `cols+1` — o teste não alcançava esse caminho | `motor/mir/tui/layout.ts` |
| **Uma das ALTA da lista original só tinha sido meio consertada.** `fase-spec.ts` recebeu o argumento novo na Onda B, mas o retorno de `runStep` continuava inteiramente descartado: falha do agente virava "spec reprovado no openspec validate" (causa falsa) e o gasto da fase não entrava no card | `motor/nmy/luc/fase-spec.ts` |
| **O classificador de merge foi adotado em 1 de 2 sítios.** `syncWithBase` continuava chamando toda falha de conflito — e mandava ao agente "Resolva os conflitos nestes arquivos: " com lista VAZIA, pagando chamadas | `motor/qlb/ctr/sync.ts` |
| **Trocar uma asserção vácua por outra.** O conserto de `board.test.ts` passou a afirmar `not.toContain('0/0')` — string que o código nunca emite | `test/mir/board.test.ts` |
| **Sanitização assimétrica.** Guardar a colagem EXPANDIDA no histórico fez o caminho não-sanitizado do marcador levar ANSI para o buffer renderizado | `motor/mir/tui/input.ts` |

Todos foram consertados, mais os achados de gravidade média e baixa dos 12 lotes
(atribuição falsa de reprovação ao crivo, `fetch` descartado no sync, `Number('')`
passando por guarda de contagem, `merge --abort` sem verificação, escape de
diretiva inalcançável em `Write` de arquivo novo, `replace_all` ignorado na
simulação do hook, `hii approve` citando comando inexistente, `/health` derrubando
o processo por porta ocupada, atalhos do item 16 invisíveis no `/help`, e mais).

### E uma segunda rodada de verificação achou defeito nos consertos dos consertos

Rodei o crivo de novo, agora **contra as próprias correções**, pedindo para refutá-las.
Voltou com mais oito, todos reais:

- **`merge --abort` avisava no conjunto oposto ao pretendido.** Nas recusas que o
  classificador reconhece o git nem começa o merge, então o abort sempre falha e o
  detalhe passou a afirmar "o worktree ficou no meio do merge" — falso. Agora o
  abort só roda se `MERGE_HEAD` existe.
- **O `detail` classificado do sync era dado morto:** `fechar.ts` tinha o HALT
  fixo em "conflito não resolvido após 3x", então fetch quebrado virava diagnóstico
  falso de conflito **e** contagem falsa de tentativas.
- **Minha guarda de fetch tornou dois testes de regressão vácuos** — o fixture não
  tinha remoto `origin`, então o laço de conflito nunca rodava e a única asserção
  era `r.ok === false`. O fixture ganhou remoto de verdade, e as asserções provam
  que o laço rodou.
- **`fase-spec.ts` reintroduziu o `parseFloat(cost_usd || '0') || 0`** que o
  `gastoDoCard` tinha acabado de substituir — e pior, gravava o total zerado de
  volta no card, apagando a evidência de corrupção e desarmando as guardas dos
  outros três pontos.
- **Fail-open no teto do gauntlet:** `gastoDoCard(...) ?? undefined` mapeava
  "corrompido" para "não sei", e a trava só compara quando sabe — o modo caro
  iniciava justamente com o registro de custo quebrado.
- **`ia.json` ilegível era read-modify-WRITE:** `/ia`, `/model`, `/effort`, `/mode`
  e `/gauntlet` liam `{}` e gravavam de volta só o papel ajustado, **destruindo a
  escolha de todos os outros papéis** — com a mensagem dizendo "vale na próxima
  tarefa". Agora recusa mexer no arquivo.
- **O `/health` ainda podia matar o daemon:** o handler chama `allCards()`, que faz
  `readFileSync` por card; um `hii rm` concorrente lançava dentro do callback HTTP.
  E `porta` era lida logo após `listen()` — assíncrono no node, o runtime de
  produção —, então `subirServidorDeSaude(0)` respondia porta 0.
- **O conserto de `help.test.ts` reintroduziu o furo de substring** que eu tinha
  acabado de fechar no arquivo irmão: com `/model` e `/mode` na lista, apagar a
  linha do `/mode` continuava verde.

Duas coisas viraram código por causa disso: `abrirPrUmaVez` (a guarda contra o
segundo PR, extraída com `executar` injetável, porque antes só era verificável por
ordem de linhas no arquivo) e `scripts/auditar.ts` (o consumidor real de `apenas`,
que antes existia só como prosa no `SKILL.md` — opção sem chamador é o mesmo
defeito que a auditoria persegue).

### Terceira rodada: o conserto do conserto do conserto

Rodei o crivo uma terceira vez, agora contra as correções da segunda. Três achados,
os dois primeiros graves:

- **O conserto do `ia.json` podia MATAR a TUI.** Fazer `ler()` lançar era certo
  (evita sobrescrever e apagar a preferência dos outros papéis), mas `aplicar` e
  `ciclarModo` são chamados de dentro do handler de **tecla** — `onKey` →
  `inp.on('data')` —, que não tem catch. Com `config/ia.json` quebrado, um Shift+Tab
  derrubava o processo com o terminal em raw mode. Agora nenhuma função exportada do
  módulo lança. E os `definir*` passaram a **propagar** o `ok: false` de `aplicar`:
  antes anunciavam sucesso sobre gravação que falhou.
- **Fail-open de escopo no script novo.** `apenas: []` significa "sem recorte", ou
  seja repositório inteiro — então `--branch` numa árvore limpa imprimia o plano do
  repo todo rotulado como "superfície da branch", e `resumoAuditoria` só avisa de
  recorte vazio para `escopo`, nunca para `apenas`. Agora sai dizendo que está vazia.
- **A guarda de lista vazia no sync agia depois do gasto.** A consulta do topo do
  laço não verificava `err`, então o agente era chamado — pago — com "Resolva os
  conflitos nestes arquivos: " vazio.

Também nesta rodada: `handleSpec` ganhou `SpecDeps` injetável (a fase decide HALT
por custo e por falha de agente, e sem a costura isso só era verificável subindo
openspec e um provedor de verdade — ou seja, não era), e o alcance externo do
`/health` virou teste que sonda de um **endereço não-loopback** — a medição que a
auditoria original não fez.

**Números:** 2442 testes em 224 arquivos, `bun run test` verde (typecheck +
`lint:types` + `lint:clone` + suíte). Baseline antes desta rodada: 2265 em 213.
Zero monolito e zero god-file na superfície da branch, medido pelo próprio auditor.

---

## ESTADO — o roadmap dos 34 itens está fechado

Itens 1 a 34, incluindo os dois novos (33 MCN, 34 MIR) e o 16, que era o último
parcial. O que vier daqui em diante entra como pendência nomeada abaixo, ou como
onda nova em `WORKFLOW-EXECUCAO.md`.

---

## RECOMENDAÇÃO — `truncVisible` percorre o texto inteiro para cortar 80 colunas

`larguraDeTexto`, `stripAnsi` e o `split` de `motor/mir/tui/layout.ts` varrem a
string toda antes do corte: medido ~189× mais caro num texto 500× maior. Não é
travamento (~0,5ms para meio milhão de caracteres, e `test/mir/tui-sob-carga.test.ts`
guarda esse tempo) — é ineficiência num caminho quente: cada linha visível paga o
custo da linha inteira.

**A dúvida registrada estava errada, e é por isso que a recomendação é fazer.** O
receio era "medir só um prefixo parte cluster de grafema quando o corte cai no
meio de um". Não parte: quem produz os clusters é `Intl.Segmenter`, e ele só
entrega cluster INTEIRO. `SEGMENTADOR.segment(texto)` devolve um iterável
preguiçoso — consumir os primeiros N segmentos não olha o resto da string e não
pode cortar no meio de um cluster, porque um cluster meio-lido não existe na
saída do segmentador. O que `grafemasDe` faz de errado é materializar o array
inteiro (`for (...) saida.push(...)`), jogando fora a preguiça que o segmentador
já dava. **Não é preciso provar margem segura nenhuma: a margem é o próprio
segmentador.**

Onde está o O(n), em ordem de peso:

1. `visibleLen(s)` no early-return de `truncVisible`. Para responder "cabe?" ele
   calcula a largura TOTAL — e dentro dele `stripAnsi` faz duas passadas de regex
   sobre a string toda, e `grafemasDe` materializa todos os clusters. A pergunta
   real é "a largura passa de `max`?", que se responde parando no primeiro
   grafema que estoura.
2. `s.split(ESCAPE_SPLIT)` — aloca a string inteira em pedaços para depois
   consumir só o começo.
3. O laço de grafemas em si já para em `teto`. Esse pedaço está certo.

**Recomendação, em três primitivas em `motor/mir/tui/largura.ts`:**

- `grafemasEm(texto): Iterable<string>` — generator delegando ao segmentador, sem
  materializar. `grafemasDe` fica como `[...grafemasEm(t)]` para quem precisa da
  lista (a tabela de `test/mir/largura.test.ts` continua valendo).
- `larguraAte(texto, teto): { colunas, indice, excedeu }` — acumula largura e para
  no primeiro grafema que passaria de `teto`. Custo O(min(n, teto)). É a resposta
  do early-return **e** o ponto de corte, no mesmo passo.
- um scanner de ANSI com regex *sticky* (`/…/y` + `lastIndex`) avançando junto,
  em vez de `split`: reconhece a sequência na posição corrente e a copia inteira
  sem quebrar a string.

`truncVisible` passa a ser uma passada só, e para no corte. `padVisible`,
`visibleLen` e a assinatura pública não mudam. `janelaHorizontal` (a rolagem
horizontal da entrada, adicionada nesta rodada) tem exatamente a mesma forma —
hoje ela também materializa todos os grafemas e deve usar as mesmas primitivas.

**Como provar que preservou comportamento:** `test/mir/largura.test.ts` fixa a
tabela exata de cortes, grafemas, surrogates e ANSI — uma reescrita que passe ali
preservou o comportamento. Falta uma guarda que pegue a REGRESSÃO de custo:
`tui-sob-carga.test.ts` mede tempo absoluto, que varia com a máquina. O que
detecta o problema é a **razão**: `truncVisible(s, 80)` com `|s|` 500× maior tem
de custar tempo aproximadamente igual (hoje custa ~189×). Uma asserção de razão
com folga generosa (por exemplo, no máximo 5×) reprova a volta do O(n) sem ficar
instável.

**Custo estimado:** três funções pequenas em `largura.ts`, reescrita de
`truncVisible` e `janelaHorizontal`, um teste de razão. Não toca a semântica de
nada.

R: pode fazer.

---

## PENDÊNCIA — o MCN diverge, mas ninguém ainda gasta token com ele

A Onda 12 entregou o mecanismo completo e ligado ao plano: `valeDivergir()` decide,
e a flag aparece em `buildPlan()` para o humano ver antes de aprovar. O que **não**
existe é o consumidor que de fato despacha os ramos contra um provedor de IA —
`despacharDivergencia()` recebe o despachante injetado, e hoje só os testes o
passam.

Isso é escolha, não esquecimento: o despachante é injetado justamente para o
isolamento ser verificável sem rede, e ligar o provedor de verdade é uma decisão
de custo (N ramos multiplicam por N) que merece ser tomada olhando o gasto real
por card, não junto com a entrega do mecanismo.

Onde mexer: `motor/agentes/clr/clarificar.ts:77` já chama `idear()` do TSL no
`CLARIFY`. É o ponto onde o MCN substitui o TSL — mesma fase, com isolamento real
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

## PLANO — migrar a suíte para um runner que rode nos dois (node:test)

Decidido: **`node:test` nativo, com um shim fino de `expect`**. Zero dependência
nova, roda sob o Node 24 da imagem de produção e sob Bun. Onda própria — este é o
plano que a decisão pedia antes de começar; nada foi executado ainda.

**Por que isto existe.** A suíte inteira roda sob `bun:test`. O CI ganhou
`node bin/hii.ts --help`, que prova que o grafo de import do CLI carrega sob Node
— não prova o resto. Não é hipótese: foi essa cegueira que deixou a Onda 11
mergear verde com uma imagem que morria em `ERR_MODULE_NOT_FOUND` no arranque,
porque o Bun resolve import relativo sem extensão e o Node não. `docker build`
dava exit 0 e ninguém tinha rodado o ENTRYPOINT.

### O que a suíte de fato usa (medido, não estimado)

| Superfície | Ocorrências | Sob node:test |
|---|---|---|
| `test`, `expect` | 219 arquivos | `node:test` dá `test`; `expect` vem do shim |
| `afterAll` / `beforeEach` / `afterEach` / `beforeAll` | 93 / 47 / 12 / 1 | `node:test` tem `after`/`beforeEach`/`afterEach`/`before` — renomear |
| `describe`, `test.skip/only/each` | **0** | nada a fazer |
| `mock` / `spyOn` / `jest.*` | **0** | nada a fazer — a injeção é por parâmetro, não por mock |
| `expect(valor, 'mensagem')` posicional | **436** de 5199 | extensão do Bun. **É o argumento decisivo contra Vitest**, que não aceita a mensagem posicional: migrar para lá exigiria reescrever 436 asserções e perderia a mensagem que explica o invariante |
| matchers distintos | 17 | `toBe`, `toContain`, `toEqual`, `toBeGreaterThan(OrEqual)`, `toBeLessThan(OrEqual)`, `toThrow`, `toBeNull`, `toHaveLength`, `toBeUndefined`, `toBeDefined`, `toBeCloseTo`, `toMatchObject`, `toBeTruthy`, `toMatch`, `toStartWith`, mais `.not` e `.rejects` |
| `Bun.file` | 40 | `readFileSync` / `readFile` |
| `Bun.serve` | 26 (10 arquivos) | `node:http` `createServer` — o motor já usa `node:http` no `/health` |
| `Bun.sleep` | 6 | `node:timers/promises` `setTimeout` |
| `Bun.spawn` | 4 | `node:child_process` |
| `Bun.which` | 1 | `spawnSync('command', ['-v', bin])` ou o próprio `runtime.ts` |

### Passos, em ordem, cada um mergeável sozinho

1. **`test/apoio/expect.ts` — o shim.** 17 matchers, `.not`, `.rejects`, e a
   mensagem posicional. Escrito sobre `node:assert/strict`, jogando a mensagem no
   `AssertionError`. Vem com teste próprio (`test/apoio/expect.test.ts`) que prova
   cada matcher nos dois sentidos: passa quando deve passar **e falha quando deve
   falhar**. Sem isso, a migração inteira pode ficar verde por shim permissivo —
   que é o defeito que esta auditoria toda persegue.
2. **`test/apoio/bun.ts` — as pontes.** `lerArquivo`, `servidorDeTeste`,
   `dormir`, `rodar`, `qualBinario`, cada uma com a implementação de `node:*`.
3. **`test/apoio/runner.ts` — a fachada.** Reexporta `test`, `expect` e os hooks
   com os nomes que a suíte já usa (`afterAll` → `after`), para o passo 4 ser um
   `sed` de import e nada mais.
4. **Troca mecânica dos 214 arquivos.** `import { … } from 'bun:test'` →
   `from '../apoio/runner.ts'`, e `Bun.file(x).text()` → `lerArquivo(x)`. Um
   commit, revisável pela ausência de mudança de asserção.
5. **Os 10 arquivos com `Bun.serve`.** Únicos que exigem leitura caso a caso, por
   causa do ciclo de vida do servidor. Feitos por último, com a suíte já verde nos
   outros 204.
6. **CI nos dois runtimes.** `node --test` e `bun test`, ambos obrigatórios. É
   este passo que fecha a falha da Onda 11 — os anteriores só o tornam possível.
7. **Invariante de fecho.** Um teste que varre `test/` e reprova qualquer
   `from 'bun:test'` ou `Bun.` remanescente, para a migração não vazar de volta.

### Medido antes de planejar, não assumido

Rodei um arquivo real da suíte (`test/cic/cnd-dominio.test.ts`) sob `node --test`
com um shim de duas linhas por matcher. Resultado: o Node 24 carregou o TypeScript
do teste **e** o módulo `motor/cic/cnd/gauntlet.ts` sem reclamar de sintaxe, e os
testes passaram — **exceto** o único que usa `Bun.file`, que falhou com
`ReferenceError: Bun is not defined`. Ou seja: type stripping não é obstáculo, e o
trabalho real é exatamente o inventário da tabela acima. `grep` por `enum` e
`namespace` em `test/` e `motor/`: zero ocorrências de sintaxe não apagável (as
duas linhas que casam são prosa em comentário e em prompt).

`test/cdl/import-com-extensao.test.ts` já guarda a extensão nos imports, que era o
outro requisito do Node.

R: pode fazer.

## DECISÃO PENDENTE — a evidência de RED premia o card que chega quebrado

Achado da auditoria desta rodada, e é **material para a decisão de ligar o
`HICODE_RIGOR_ESTRITO=1`**: o interruptor funciona, mas o que ele cobra não é o
que o item 5 diz cobrar.

O único produtor de evidência de RED é `registrarRed`
(`motor/cic/crv/portoes-de-fecho.ts:97`), chamado quando a **primeira rodada do
comando de teste reprova** no fecho. Daí sai o incentivo invertido:

| Card `completo` que… | Tem RED? | Com rigor estrito |
|---|---|---|
| chega com a suíte **verde** (TDD feito no worktree, tudo passando) | **não** | **HALT** |
| chega **quebrado** e é reparado pelo motor | sim | passa |

Ou seja: o card bem-feito para e o card que chegou vermelho passa. Corrigi o que
era mecânico (a ordem da consulta, na Onda C, e o teste que certificava a ordem
invertida, nesta rodada) — mas **isto não é conserto mecânico**: mexer aqui muda o
que o item 5 mede, e por isso fica para a sua palavra.

`test/agentes/chg-red-primeiro.test.ts` prende os dois casos com o nome `LIMITE`,
para o comportamento não derivar enquanto a decisão não vem.

As saídas que enxergo:

1. **Observar o RED na fase de execução, não no fecho.** Rodar o comando de teste
   uma vez ANTES do passo `testes` e uma vez depois: baseline verde + pós-passo
   vermelho é RED de verdade (o teste novo falha contra o código que ainda não
   existe). Custa uma execução de suíte por card `completo` e é a única forma de o
   motor VER o ciclo em vez de acreditar no relato.
2. **Exigir o RED do agente de teste, com evidência.** O `testudo` roda o teste
   novo e anexa a saída vermelha ao diário antes de implementar. Mais barato, mas
   volta a depender do que o modelo diz ter feito — que é o que este gate existe
   para não aceitar.
3. **Trocar a exigência.** Em vez de "houve RED", cobrar "o diff toca teste E
   código" — verificável, barato, e mais fraco: não prova ordem.

Enquanto não houver decisão, ligar o rigor estrito vai parar todo card `completo`
com suíte verde. Isso é diferente do que a seção abaixo dizia antes desta rodada.

R: pode fazer 2.

---

## ESTADO — o que está atrás de `HICODE_RIGOR_ESTRITO=1`

Decidido: **LIGAR**. O interruptor é `HICODE_RIGOR_ESTRITO=1` no ambiente — não há
mudança de código a fazer, e por isso ligar é ato de operação, não de commit: quem
liga escolhe o momento em que os cards em voo podem parar.

O que mudou nesta rodada é que o interruptor ficou **utilizável de verdade**. O CHG
(item 5) foi consertado na Onda C, e nesta rodada `test/agentes/chg-red-primeiro.test.ts`
passou a provar a ordem certa com guarda contra o `-1` — antes o invariante
certificava a ordem invertida. Até a Onda C, ligar pararia todo card no perfil
`completo`, porque `red_antes_do_green` era constante `nao`.

**Antes de ligar, saiba o que passa a barrar:** os três itens abaixo. O item 5
**funciona mas cobra a coisa errada** — veja a seção anterior: card `completo` com
suíte verde vai fazer HALT. O 22 e o 4 escrevem o veredicto no card e nunca
barraram ninguém, então o primeiro card `completo` depois de ligar é o primeiro
teste real deles. Ligar num momento de fila vazia é mais barato que ligar no meio
de uma onda.

Três exigências já escrevem o veredicto no card e só barram com o interruptor
ligado:

| Item | Exige | Campo no card |
|---|---|---|
| 5 | perfil `completo` teve teste que FALHOU antes de passar | `red_antes_do_green` |
| 22 | área nova tem comando de teste no contrato do alvo | `setup_ferramental` |
| 4 | matriz de entendimento respondida antes de aprovar o plano | `matriz_entendimento` |

Enquanto desligado dá para ver, card a card, quem passou sem provar — que é o
insumo para decidir quando apertar. Ligar hoje pararia todo trabalho em voo.

---

## ESTADO — mecanismo pronto sem consumidor, por decisão

Não são pendências: são escolhas registradas para não parecerem esquecimento.

**Item 18 (`executarEmBlocos`).** O laço de `motor/qlb/ctr/fechar.ts` já faz
executa → valida → para cedo. Rotear por TJL ali é cerimônia. O valor real —
fatiar uma implementação em blocos validados — exige fatiador determinístico por
stack, que pertence à camada de skill, não ao `core/`.

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

**FEITO** — razão medida caiu de **417×** para **0,98×** (Unicode) e de 140× para
0,97× (ASCII). Duas armadilhas que a recomendação não previa: um laço por code unit
até achar o próximo ESC devolvia o O(n) pela porta dos fundos, e o `Intl.Segmenter`
tem custo de **preparo** proporcional a |s| — iterar preguiçosamente não basta, a
string entregue a ele tem de ser pequena. Daí a segmentação em **janelas**, com o
último grafema adiado para a janela seguinte porque ele pode continuar depois do
corte. Verificado que o resultado é idêntico ao de segmentar tudo de uma vez,
inclusive com grafema atravessando a borda.

O teste de carga que existia media a razão por **colunas pedidas** e passava com
folga — justamente porque tudo era O(n) e o número de colunas não mudava nada. Ele
certificava o defeito. Trocado pela razão por **tamanho da entrada**, nas duas
famílias.

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

**FEITO** — os sete passos. A suíte roda nos dois runtimes: **2566 testes sob bun**
e **2561 sob `node --test`, em 32s**, e `bun run test:node` entrou no CI ao lado de
`test:unit`.

O que o node encontrou na primeira execução, e que nenhum teste podia ver antes:
`import.meta.dir` é extensão do bun (11 arquivos), `require()` não existe em ESM
(5 arquivos), import dinâmico precisa da extensão **antes** da query de cache, e
JSON por `import()` exige atributo de tipo. Nenhuma delas aparece como teste
vermelho — elas derrubam o arquivo no **carregamento**, e o arquivo some da
contagem, que é pior de notar. Cada uma virou invariante em
`test/apoio/migracao-node-test.test.ts`.

Duas armadilhas da troca mecânica: `Bun.spawn` em
`test/euc/idempotencia-contrato.test.ts` só existe **dentro de string** (é o dado do
teste), e o sed reescreveu como se fosse chamada. E o próprio
`expect-diferencial.test.ts` teve o import reescrito para a fachada — passou a
comparar o shim **consigo mesmo**, quatro testes verdes provando nada. Ele agora
reprova se apontarem os dois lados para o mesmo motor.

E duas coisas que só apareceram rodando a suíte inteira no node até o fim:

**A suíte não era lenta — ela travava.** Seis arquivos que criam a TUI prendiam o
processo por causa do `setInterval` de repintura, que o bun ignora ao sair e o node
respeita. Travamento é pior que falha: o processo fica vivo sem reprovar e sem
terminar, e no CI isso vira "job demorou demais" em vez de "teste X quebrou".
`--test-timeout` **não** pega esse caso — ele mata teste lento, não processo com
handle aberto. Com `unref()` no timer (que é o certo: repintura não pode ser a razão
de o processo viver), a suíte passou de "não termina em 20 minutos" para **32
segundos**.

**A ponte de servidor não punha `Content-Length`**, que o `Bun.serve` põe sozinho.
O node respondia em chunked, e um teste de teto de download — que depende do tamanho
**anunciado** — deixou de testar o que testava. Fidelidade da ponte é o que separa
migrar de reescrever o teste sem perceber.

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

**FEITO** — opção 2 implementada, com a fraqueza dela tratada, não escondida.

O passo de testes, **só no perfil `completo`**, recebe a exigência: escrever o teste
antes, rodar o comando de teste do alvo, e **colar a saída real** entre
`<<<RED>>>` e `<<<FIM RED>>>`. A instrução e o leitor moram no mesmo módulo
(`motor/agentes/chg/red-primeiro.ts`) para o formato exigido e o formato lido não
poderem divergir.

O que o motor **consegue** conferir naquele texto, ele confere: que o bloco existe,
que tem corpo (duas linhas ou 40 caracteres — o sumário do `node --test` é legítimo
e curto), que tem sinal de falha, e que **não é uma suíte verde**. Essa última é a
que faria a exigência virar carimbo: relatório verde **contém** a palavra "fail",
em "0 fail". Se a busca por sinal de falha viesse antes da checagem de verde, a
suíte inteira passando seria aceita como evidência de RED. As três ordens de
contagem estão cobertas — `0 fail` (bun), `failed: 0` (jest/vitest) e `fail 0`
(node:test).

O que o motor **não** consegue é saber se o comando rodou mesmo. Por isso a
evidência é **marcada na origem**: `[motor observou]` quando o comando reprovou na
primeira rodada do fecho, `[agente anexou saída]` quando veio do relato. As duas
valem, não valem o mesmo, e quem audita o card vê a diferença sem ir ao código.

Isso desfaz o incentivo invertido: o produtor do motor só vê a suíte já com o código
escrito, então **TDD bem-feito chega verde e não deixa rastro** — era por isso que o
card bem-feito parava e o que chegava quebrado passava.

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

---

## PENDÊNCIA — o card trava porque há estado sem consumidor, e o laço não sabe que não progride

A máquina de estados tem 15 estados; apenas 5 têm consumidor automático dentro do tick
(`motor/osw/mtr/fila.ts:97-100`, `pending()` → handlers). Os outros 10 são checkpoints
humanos, estados de boot ou — o pior — estados que nunca saem sozinhos. Card 001 está
em `URL` desde 19/08. Card 002 em `HALTED` sem sinal de por quê. Ambos têm `updated`
recente porque cada log que cai escreve `fm.updated = isoNow()` (`motor/cdl/store.ts:58`),
mascarando staleness.

`reconciledStranded()` (`motor/osw/mtr/estado-da-fila.ts:44-52`) roda uma única vez no
boot, assume que um card é órfão se não está em estado terminal conhecido, e **refuta**
estados reais: `URL`, `CLARIFY`, `READY`, `PAUSED`, `CONFIRM`, `HALTED` — os seis que
o motor hoje **não consegue destravar**. A lista `checkpointsHumanos` em `config/topologia.json:74`
declara `["URL","CONFIRM","PR_OPEN"]`, e o teste `test/nmy/topologia.test.ts:110-121` valida
a cadeia de estados per-perfil, nunca a decisão de "quem espera humano". De fato `PR_OPEN`
**tem** consumidor (`motor/qlb/ctr/merge.ts:39`, roda a cada 30 s) — o único checkpoint
que o motor tira sozinho. Três dos quatro checkpoints reais (`READY`, `CLARIFY`, `PAUSED`)
não estão na lista.

**O laço quente, o problema concreto:**

`handleExecute` (`motor/osw/executar.ts:309-314`) em falha de cota de provedor devolve sem
mudar status — o card fica em `EXECUTING`. Redespachado em ≤5 s porque `fila.ts` não tem
cooldown por card (`:97-100` só filtra `emVoo`, `:31` só reveza na chamada). `provider_override_implement`
(`executar.ts:312`) é gravado mas **nunca apagado** — grep mostra escritor único em `:312`,
zero leitores de limpeza. Card cravado no fallback para sempre. Se a cota original reset,
o override continua ativo.

Em outro caminho, `quotaFallbackProviderFor` (`motor/tmd/registro.ts:134-137`) é chamado em
`executar.ts:309`, devolvendo um provedor. Mas o código devolve sem troca de estado:
`:311-314` grava o override em `patchCard(id, { provider_override_implement: fallback })` e
segue — o card não sai de `EXECUTING`. É redespachado. A segunda volta `:311` bate em
`if (res.provider === fallback)` — a condição falha — e cai em `applyFailurePolicy`, que
classifica a falha como `quota` e vai direto a `HALTED`. **Primeiro retry: fallback; segundo:
parede.**

**A contagem de tentativas se comporta de forma complexa por fronteira de passo** — `wait_attempts`
ressurge em cada fronteira de sucesso (`fechar.ts:293`), mas entre passos **consecutivos do
mesmo `handleFinish` há oito retomadas sem resset** (A4 em Rufus). A conta acumulada é ~40
passagens do `handleFinish` antes de qualquer HALT por espera. Vezes 4 passos + pós-passos =
~200. Por passagem de `handleFinish`, o pior caso verificável é: `maxReajuste()` = 2
(`motor/cdl/ali/config.ts:60-62`) dá **três voltas** no laço de `motor/cic/passo-com-gate.ts:64`, e
cada volta custa uma chamada do agente mais até duas do crivo (`GATE_RETRIES` = 1, `config.ts:64`)
— nove chamadas por passo gated, vinte e sete nos três passos gated, mais o passo não gated.
Resultado: **ordem de centenas de chamadas de IA por card, dentro dos tetos declarados, sem
ninguém intervindo, todas podendo voltar sem progresso**. O multiplicador exato depende de quantas
retomadas de espera cada fronteira de passo concede na prática, e essa medição não foi feita —
o que está provado é a ordem de grandeza e o fato de nenhuma delas bater no teto. Card 002 prova: `13:20:03 EXECUTING->WAITING (tentativa 1/8)` e `13:20:33
WAITING->EXECUTING sonda de saude ok` — um timeout de 900 s do CLI foi "curado" por um GET
de 5 s no host da API, porque `probeProviderHealth()` (`motor/tmd/sonda.ts:14`) retorna `true`
para qualquer código `> 0 && < 500` — código 429 conta como saudável. `wait_provider` vazio
devolve `true` incondicional.

**Deriva de transição:** `config/topologia.json:9-46` declara pares (origem, destino). `planSteps`
(`motor/osw/rta/perfil.ts:227-242`) combina perfil + pipeline, produzindo **6 pares não declarados**:
`URL_OK→TESTS_GREEN`, `URL_OK→CLEANED`, `URL_OK→SEC_CLEARED`, `REFINED→SEC_CLEARED`, `REFINED→CLEANED`,
`TESTS_GREEN→CLEANED`. Quatro são heurísticos, dois foram observados. O teste `topologia.test.ts:110-121`
valida o pipeline **completo**; nunca chama `planSteps` para cada perfil ativo.

**Onde mexer:**

- `motor/cdl/store.ts:53` — adicionar campo `status_since` (gravado só quando o status muda,
  não em todo `patchCard`). Habilita staleness real e timeout de checkpoint.
- `motor/cic/rpr/politica.ts:72` — antes do `if (input.failureClass === 'quota')`, branch para um
  roteador que decide troca (seção PLANO abaixo).
- `motor/tmd/registro.ts:134-137` — `quotaFallbackProviderFor` deixa de ser chamada aqui; a
  decisão de rota integrada no roteador a substitui. O override é limpo em `executar.ts:372`
  (implement bem-sucedido).
- `motor/osw/rta/perfil.ts` — somar os 6 pares a `topologia.json`; `topologia.test.ts:110-121`
  passa a varrer `planSteps(perfil)` para cada perfil ativo, não só o pipeline.
- `motor/cic/crv/url-viva.ts:56-62` — `ensureUrl` já confere URL viva; criar consumidor em
  `motor/osw/mtr/fila.ts:83` (`podar()`) que reconfire `url_pid` mortos e marca `url_estado`.
- `motor/osw/mtr/fila.ts:29` — o catch-all de `runJob` manda pra `HALTED` sem `halt_class`.
  Todas as ~26 escritas de HALT precisam de classe (`transient`/`quota`/`terminal`/`humano`/`orcamento`/`excecao`).

**O que fica em aberto:**

Prioridade de qual laço sair do travamento: se o roteador (PLANO) destravar a quota, a contagem
falsa de tentativas fica em segundo plano — o card terá mais oportunidade antes de HALT. Se
corrigir `cost_usd` no frontmatter (RECOMENDACAO item 3), o teto de orçamento deixa de ser
decorativo. Ambos são pré-requisitos para o terceiro: detecção de não-progresso (item 5 em
CORVINUS, hash de `gate.reason` entre voltas).

---

## PLANO — transformar motor/tmd/registro de harnesses em roteador de rotas

O contrato `Harness` já declara capacidade em dois lugares: `capabilities()` devolve
`HarnessCapabilities` com seis booleanos (`restrictsTools`, `isolatesReadonly`, `acceptsEffort`,
`reportsCostUsd`, `reportsTokens`, `mcp`) — `motor/tmd/tipos.ts:56-63` — e o próprio `Harness`
declara `supportsAgents`, `supportsVision` e `agentic` como campos, `motor/tmd/tipos.ts:101-105`.
São dados de capacidade que já existem; o que falta é alguém consultá-los para decidir rota.
Hoje só `isolatesReadonly` é lido, em `motor/euc/tsr/confianca.ts:74-82`.
A classe de erro já é normalizada por harness (`sinaisDeFalha()`, `:47-51`) e `classifyFailure`
(`motor/cic/rpr/classe-de-falha.ts:43-53`) cruza com genéricos. `probeProviderHealth()`
(`motor/tmd/registro.ts:112-115`) existe mas é **lido só por `espera.ts:69`** — nunca para escolher.
`TrocaDeProvedor` (`motor/cdl/tipos.ts:76-81`) é tipo que nada preencheu. O roteador que falta
é um decisor aditivo (nunca piora o comportamento atual, só acrescenta uma saída antes do HALT),
chamado de dentro de `decideOutcome` (`motor/cic/rpr/politica.ts:72`).

**Assinatura concreta, sem dependência nova:**

```ts
// motor/tmd/rota.ts — novo arquivo, só imports de tmd/
export interface EntradaDeRota {
  papel: AgentRole                          // implement | verify | gate | step
  classeDeFalha: FailureClass               // transient | quota | terminal
  provedorAtual: HarnessId
  tentadosNestaRodada: readonly HarnessId[] // quem já falhou NESTA rodada
}

export type DecisaoDeRota =
  | { acao: 'manter_politica_atual'; motivo: string }
  | { acao: 'trocar'; para: HarnessId; motivo: string }

export function decidirRota(e: EntradaDeRota): DecisaoDeRota
```

Regras (tudo com dado que o motor já tem):

1. `terminal` → `manter_politica_atual` (preserva HALT de hoje).
2. Candidatos = lista ordenada do papel em `PreferenciaDePapel.providers?: string[]`
   (`motor/tmd/preferencias.ts:13-25`, extensão retrocompatível do campo `provider` singular).
   Fallback: `providerNames()` (os quatro conectados).
3. Filtra por `tentadosNestaRodada` (não repetir quem falhou ESTA rodada), por `capabilities()`
   (papel `implement` exige `agentic`, papel `verify` exige `isolatesReadonly` — regra que já
   existe em `motor/euc/tsr/confianca.ts:74-82`, hoje só para recusar), por `autenticado()`,
   por `janelasDoProvedor` (cota estourada, `motor/tmd/disponibilidade.ts:28-31`).
4. Ordena preferindo `rodaLocal` quando mecânico (papel `step`/`verify` sem escrita).
5. Lista vazia → `manter_politica_atual`. Nunca piora.

**Encaixe em pontos concretos (sem redesenho):**

- `motor/cic/rpr/politica.ts:72` — antes do `if (input.failureClass === 'quota')`, branch:
  ```ts
  const rota = decidirRota({ papel: input.papel, classeDeFalha: input.failureClass,
    provedorAtual: input.provider, tentadosNestaRodada: card.rota_tentados?.split(',') ?? [] })
  if (rota.acao === 'trocar') {
    return patchCard(id, { rota_tentados: `${rota.para}` }, ...) + retry com novo harness
  }
  ```
- Seis chamadores de `providerFor` em `agente.ts:350`, `gate.ts:229`, `avaliar.ts:20`,
  `clarificar.ts:96`, `ideate-run.ts:25` passam a aceitar `override?: HarnessId` opcional
  (como `implement` já aceita em `executar.ts:309-315`).
- `motor/tmd/preferencias.ts` — campo novo `providers?: string[]` é opcional; código existente
  que usa `provider` singular segue funcionando.
- Campo novo `rota_tentados` no frontmatter do card (CSV de HarnessId) — escrito por `patchCard`,
  limpo por `haltFields` (item 15 em Rufus) e pelo sucesso.

**O que já passa a funcionar com esse roteador mínimo:**

Failover de quota entre claude↔codex↔kimi para `implement`; entre claude↔codex↔ollama para `verify`.
Card em `EXECUTING` com quota de claude redirecciona para codex no mesmo tick. Tiering de modelo
(próximo item, RECOMENDACAO) passa a ser consultável no ponto de escolha.

---

## RECOMENDAÇÃO — onde o dinheiro queima hoje, e a ordem de corte

**O custo acumulado no frontmatter fica obsoleto durante a execução.** `motor/cic/corrigir.ts:126-134`
fecha o fluxo de sucesso da correção gravando `status`, `correction`, `verify` — **sem `cost_usd`
nem `tokens_total`**. O custo (`r.cost`) entra só como texto na mensagem de log (`:134`). Resultado:
guardar a correção anterior não atualiza o frontmatter. **Prova em card 001:** linhas 11-12 têm
`cost_usd: 2.2684` (soma dos três passos anteriores, 179311 tokens); linha 68 registra a correção
que rodou depois: `"custo $1.5380 · 92122 tokens"` — texto puro, nunca estruturado. Frontmatter segue
em 2.2684. **Impacto:** todo guard de orçamento que lê `card.fm.cost_usd` (5 sítios: `executar.ts:170`,
`corrigir.ts:88`, `fechar.ts:71`, `fase-spec.ts:78`, `gate.ts:217`) faz decisão sobre número 41%
desatualizado. TRAVA 2 do gauntlet (`motor/cic/cnd/gauntlet.ts:166-168`) que rebaixa o modo quando
gasto passa do teto pode deixar o modo caro ativo por falta de visibilidade.

**A conta de chamadas de IA** dentro do teto declarado, com as constantes conferidas: uma passagem
de `handleFinish` com quatro passos, três deles gated, custa até vinte e sete chamadas só nos
gated — três voltas por passo (`maxReajuste()` = 2 em `motor/cdl/ali/config.ts:60-62`, laço em
`motor/cic/passo-com-gate.ts:64`), cada volta com uma chamada do agente e até duas do crivo
(`GATE_RETRIES` = 1, `config.ts:64`) — mais o passo não gated. Multiplicado pelas retomadas de
espera por fronteira de passo (A4), chega à ordem de centenas antes de qualquer HALT, **nenhuma
batendo o teto, porque a conferência acontece só na entrada do handler e nunca dentro do laço de
passos**. Ao custo observado de US$3,0416 num único passo do card 002 (`.runner.log:30`), não é
preciso chegar perto de centenas de chamadas para o card passar do limite de US$16 sem que ele
dispare: bastam seis passos daquele porte. O teto de orçamento não segura — essa é a conclusão
provada. O número exato de chamadas por card continua **sem medida** e precisa ser instrumentado
antes de virar meta de corte.

**Tiering de modelo já é computado e descartado.** `motor/osw/rui.ts:40-63` computa `EscolhaDeTier`
(tier + motivo) para 9 ações em `motor/cdl/ali/config.ts:24-28` — `registrarTier` (`:56-63`) manda
o resultado para `anexarEvento` e acabou. Nenhum consumidor em `providerFor`, `modelFor`, `effortFor`.
A decisão de custo **nunca alimenta a escolha do custo**.

**Cache de prefixo:** está correto (`motor/tmd/eco/prefixo.ts` replica exatamente a disciplina de
prefixo fixo + sufixos append-only, auditado em byte). Não mexer.

**Ordem de corte, do dano maior para menor:**

1. **Gravar `cost_usd`/`tokens_total` em todo `patchCard` de sucesso dentro do laço** (`motor/cic/corrigir.ts:126-134`,
   `motor/cic/passo-com-gate.ts:93`, `motor/qlb/ctr/fechar.ts:293`). Chamar `accumulatedTotals(card, fsteps)`
   que já existe (`motor/euc/metricas-de-fecho.ts:35-39`). Sem isso, o terceiro item abaixo fica cego.

2. **Conferir `gastoDoCard` no topo do laço de passos** (`motor/qlb/ctr/fechar.ts:200`), não só na
   entrada do handler. Hoje só `fase-spec.ts:99` faz (por volta de retry). Uma passagem inteira de
   passos inteira roda entre duas conferências. [-> Celer para calibrar o teto real]

3. **Mapear tier → (provedor, modelo, esforço) e consultar em `providerFor`/`modelFor`/`effortFor`.** 
   `config/model-tier.json` tem os dados; `preferencias.ts` já lê a config. Um mapa `tier->default`
   como guia de fallback em ausência de override por papel. Sem descobrir o que tier significa em
   moeda de IA, nada mais aqui faz sentido.

4. **Detectar não-progresso com hash de output entre voltas.** `motor/cic/passo-com-gate.ts:75` instrui
   "Refaça o passo do zero" — reset, não convergência. Hash de `gate.reason` normalizado entre
   voltas 1 e 2: se idêntico, parar antes do teto. Idem em `motor/cic/reparo.ts:51` (`repararAteOTeto`)
   com `veredicto.detalhe`. Dados já coletados em `motor/cic/rpr/tentativas.ts` (appendAttempt) e
   descartados por nenhum decisor consultá-los. [-> Corvinus item 4]

---

## ESTADO — o que o motor não consegue ver quando um card para

Três achados de diagnosticabilidade, que explica por que card 001 em `URL` há 4 dias não grita e card 002
em `HALTED` não diz por quê. O script que responde `/health` faz `lerSaude()` → `{"ok":true,"encerrando":false,"emVoo":0,"pendentes":0,"falhasSeguidasNoTick":0,"ultimoErro":""}` porque
`recordTickSuccess()` zera o contador de falhas sempre que o `tick` não lança exceção — mesmo que nenhum
card tenha mudado de estado. Não há campo que meça "ciclos improdutivos seguidos".

`halt_class` é escrito em apenas 2 sítios (`motor/cic/rpr/espera.ts:36`, `politica.ts:35`) e lido em 1
(`motor/euc/rdr/saude.ts:115`). Os outros ~26 `HALT` (via `motor/mir/acoes.ts:173`, `executar.ts:172,181,191,263,272,359`,
`corrigir.ts:90,94,104`, `fechar.ts:73,77,89,97,109,121,138,151,365,391`, `fase-spec.ts:45,56,80,85,100,113,117,124`,
`metricas-de-fecho.ts:44-49`) cravam `status: HALTED` sem classe. Card 002 (`cards/002-faca-outro-modelo-de-ranking-current-ses.md:4`)
prova: frontmatter sem `halt_class`, `halt_at`, `halt_reason`. O último log é texto livre. `porHalts`
ignora o card e retorna "ocioso". Motor responde verde.

`status_since` não existe no frontmatter. `updated` é gravado **incondicionalmente** em todo `patchCard`,
inclusive nos que não mudam campo nenhum (`motor/cic/passo-com-gate.ts:32,107,119`). Um card em laço de
reparo renova `updated` a cada log → idade aparente ≤ 2 min → invisível enquanto está laçando. Os
6 estados sem consumidor automático (`READY`, `CLARIFY`, `PAUSED`, `CONFIRM`, `HALTED`, `URL`) estão
ausentes de `isActive()` (`motor/mir/render/phases.ts:34-36`) — nenhum deles aparece em rodapé com
idade. Lista "esperando você" não tem coluna de tempo. Um card em `URL` há 4 dias renderiza idêntico a
um lá há 4 segundos.

O tipo `'human_checkpoint'` de evento existe em `TIPOS_DE_EVENTO` (`motor/euc/eventos.ts:19`) e é citado
como implementado em docs, mas **grep encontra zero emissores** de `anexarEvento` com esse tipo. `checkpointsHumanos`
em `config/topologia.json:74` está tipado e parseado, com zero consumidores de produção. Nada sabe que
`URL` *é* checkpoint, nada pode ter timeout.

**Sinal que falta, em ordem de impacto:**

1. `status_since` no frontmatter — gravado só quando status muda (não em todo `patchCard`). Em
   `motor/cdl/store.ts:53`, onde já há `resolvedFields.status !== undefined` e chamada de `conferirTransicao`.
2. `halt_class` obrigatório em toda escrita `HALTED` — com classes novas (`humano`, `excecao`, `orcamento`,
   `escopo`) para casos hoje mudos. Ponto de estrangulamento único: `motor/cdl/store.ts:43-65` confere
   status antes de gravar; ali se recusa/carimba HALT sem classe.
3. Evento `human_checkpoint` emitido **no ponto de entrada** do checkpoint (`motor/cdl/store.ts:53`,
   onde já se sabe se é transição) com `chave` = status e `resultado` = `aberto`. Emitido também na
   **saída** (`motor/mir/acoes.ts:81-90` approveUrl, `acoes.ts:115-125` confirmar, `motor/qlb/ctr/merge.ts:23`
   fechado) com `resultado` = `atendido`.
4. Tick sem progresso detectável — em `motor/osw/mtr/fila.ts:105`, comparar assinatura de estado da
   fila (par `id:status` de `allCards()`) contra tick anterior. Gravar `ticksSemProgresso` em
   `motor/euc/rdr/tick.ts:6-10` (`DaemonHealth`). `/health` degrada para 503 (ou `ok:false`) quando
   motor está de pé e improdutivo.
5. Campo `diffHash` + `criterio` do veredito em evento `gate_verdict` — `motor/cic/passo-com-gate.ts:114`,
   com `chave: diffHash` do diff acumulado (`motor/cic/crv/gate.ts:131`). Três vezes o mesmo hash =
   laço comprovado, não inferido.
6. Agregador de histórico por harness (taxa de falha por classe, latência p95) — varredura de
   `motor/euc/tsr/cota-runs.ts` que já faz `loteDesde()` estendida a agrupar por `provedor`.
   Base para o roteador (PLANO acima) ter memória observada.
7. `/health` checando card preso em checkpoint — teto de dias em aberto sem sinal de progresso.

Dois itens adicionais para o operador diagnosticar à mão, hoje invisíveis:

- `hii doctor` não olha card — `motor/euc/rdr/doctor.ts:196-203` pula de checagem de ambiente direto para
  daemon. Quando um card parou, o doctor responde tudo verde e deixa o humano sem pista.
- Drenagem incompatível — `motor/osw/mtr/encerramento.ts:11` (`HICODE_SHUTDOWN_TIMEOUT_MS`=30 s) contra
  `motor/cdl/ali/config.ts:48` (`RUN_TIMEOUT_MS`=900 s). SIGTERM durante agente mata o filho; custo da
  passagem nunca é escrito, portão de orçamento funciona com número subconta.

**O que fica em aberto:**

Timeout automático de checkpoint humano — nenhuma das referências abertas (OpenRouter, Claude Code Agent
SDK, OpenCode) documentam escalação automática por timeout. Falta decisão de produto. Enquanto não houver,
o sinal de "aberto há quanto tempo" (item 1 acima, `status_since`) habilita alertas manuais.

Reaper de `url_pid` e worktrees órfãs — já foi mencionado em PENDENCIA acima. Trata-se do mesmo padrão:
reconferir saúde de recurso que foi delegado e nunca se verifica depois.


---

## ESTADO — a costura entre o motor e a TUI, e as três coisas chamadas sessão

Levantado por varredura de import sobre `motor/`, `bin/`, `test/` e `runner.ts`, com o resultado
conferido arquivo por arquivo pelo crivo. **O núcleo importa da TUI: 21 arestas, em 14 arquivos.**
A dependência está invertida, e não é um caso isolado — é o padrão. Alguns exemplos que mostram o
tamanho do problema: `motor/cic/agente.ts:2` e `motor/qlb/ctr/fechar.ts:2` puxam
`objetivoComInstrucoes` de `mir/instruir.ts`; `motor/cic/crv/url-viva.ts:7` puxa `devCommand` e
`devCwd` de `mir/comandos.ts`; `motor/euc/rdr/progresso.ts:13` puxa `PHASES` de
`mir/render/phases.ts`; e `motor/tmd/map/comandos.ts:5` puxa `stripAnsi` de `mir/tui/layout.ts` —
a camada de **provedor** dependendo de renderização de terminal.

O que a varredura mostrou e que muda o diagnóstico: **cinco arquivos de `mir/` não são TUI coisa
nenhuma.** `mir/acoes.ts` (a API de escrita de card), `mir/instruir.ts`, `mir/comandos.ts`,
`mir/progresso.ts` e `mir/historico.ts` importam só de `cdl/`, `qlb/`, `tmd/eco` e `euc/tsr` — e
`grep -c $'\x1b'` devolve zero nos cinco. É motor puro morando no endereço errado. A inversão,
portanto, não é acoplamento a ser cortado: é **domínio que precisa mudar de casa**.

**Não há ciclo de import a desfazer.** Tarjan sobre o grafo completo devolve exatamente dois
componentes fortemente conexos, e nenhum deles atravessa a fronteira: `mir/render/execucao.ts` ↔
`mir/atividade.ts`, e `osw/mtr/encerramento.ts` ↔ `osw/mtr/estado-da-fila.ts`. No nível de módulo a
inversão é bidirecional com sete módulos, mas no nível de arquivo dá para reordenar à vontade sem
risco de deadlock de import.

**O que já serve de contrato entre os dois lados** e não precisa ser inventado: `motor/euc/eventos.ts`
é o barramento (`TIPOS_DE_EVENTO` fechado em 11 tipos, `:13-28`; `anexarEvento` append-only em
`cards/runs/<card>.eventos.jsonl`), `motor/cdl/store.ts` é o estado compartilhado, e
`motor/euc/rdr/servidor.ts` já expõe `/health`. Falta uma coisa só, e é notificação: hoje a TUI
descobre mudança por `fs.watch` em `mir/watch.ts`. Para a TUI virar cliente do motor, isso basta.
O que **não** existe é um tipo único de fronteira: o estado do motor para quem desenha está partido
em `SnapshotDoMotor` (`mir/estado-json.ts:64`, com `VERSAO_DO_CONTRATO = 1` em `:22` — o contrato de
saída do motor escrito dentro da TUI), `EstadoDaConfig` (`mir/render/config/tipos.ts:57-70`) e
`SaudeDoMotor` (`euc/rdr/saude.ts`, esse já no núcleo).

### Sessão são três coisas diferentes com o mesmo nome

1. `motor/euc/sessao.ts` — 18 linhas, `let atual = ''`, id `<timestamp>-<pid>`. **Sessão é o processo.**
2. `motor/euc/ias-da-sessao.ts` — `abrirSessao`, `registrarChamada`, `agregarPorIa`, `trocasDeProvedor`.
   **Sessão é um ledger append-only por execução**, em `cards/runs/<sessao>.ias.jsonl`.
3. `motor/mir/sessao.ts` — `SessionState` (`:10-26`) e `handle` (`:245`). **Sessão é estado de tela.**

A ponte entre a primeira e a segunda é uma concatenação de string:
`sessaoParaChamada(id)` devolve `sessaoDoCard(id)` quando há card, e `conversa-<sessaoAtual()>` quando não há —
`motor/euc/tsr/confianca.ts:84-86`, consumida por `motor/cdl/ali/snapshot.ts:132`.

**O que fazer, e onde.** A fronteira é: núcleo = tudo menos `mir/`, mais os cinco arquivos acima;
interface = `mir/render/`, `mir/tui/`, `mir/cli/`, `despacho.ts`, `sessao.ts`, `responder.ts`,
`completar.ts`, `watch.ts`; composição = `bin/hii.ts`, `bin/repl.ts`, `runner.ts`.

**O que fica em aberto — e por que não há plano de movimentação aqui.** A sequência de passos que
moveria esses arquivos foi escrita três vezes e **reprovada nas três** pelo crivo, sempre por
obstáculo real, nunca por preciosismo. Os três obstáculos, para quem for tentar de novo:

- `renderProgress` é importado por `runner.ts:3` e chamado em `:43`. Movê-lo para o lado da interface
  faz o entrypoint headless depender da apresentação — o oposto do objetivo.
- `test/mapa-de-rename.test.ts` e `scripts/renomear-brazil.mjs` **travam o mapa de arquivos**. Há um
  `TOTAL_ESPERADO` e um mínimo por domínio (`mir` ≥ 57, com 62 em disco: cinco de folga), mais uma
  exigência de injetividade. Metade dos passos propostos deixava a suíte vermelha.
- `PHASES` carrega `color: '\x1b[...'` (`mir/render/phases.ts:8-13`). Movê-lo verbatim põe ANSI no
  núcleo e quebra o próprio invariante que a separação existe para criar. O campo tem um único
  consumidor (`euc/rdr/progresso.ts`), que vai para o lado da interface de qualquer forma — então o
  certo é o campo sair do tipo, não viajar junto.

Mover arquivo neste repositório é caro por decisão de projeto, e o mapa de rename é a razão. Quem
retomar isto começa por aí, não pelo grafo de imports.

---

## PENDÊNCIA — o revezamento de IAs não tem onde acontecer, e a troca que já existe é invisível

O pedido é começar uma tarefa numa IA, trocar no meio, voltar, e terminar noutra. A pesquisa e a
leitura do código dizem duas coisas incômodas, e as duas mudam o que dá para prometer.

**Primeira: continuidade fiel de conversa entre os harnesses não existe, e não é limitação do hii.**
Os provedores conectados aqui são binários de CLI com loop de ferramentas e sessão próprios —
não uma API de completion crua. Cada um resume só a si mesmo: `claude --resume` lê
`~/.claude/projects/`, `codex exec resume` lê JSONL em `~/.codex/sessions/`, formatos proprietários
e estruturalmente diferentes, sem adaptador entre eles. E mesmo entre modelos do mesmo fornecedor,
cache de prefixo é hash de (ferramentas + system + mensagens) **e específico do modelo**, e blocos de
raciocínio precisam voltar inalterados à mesma API. Ou seja: o que atravessa uma troca é texto final,
nunca raciocínio em progresso nem cache aquecido. O único padrão que generaliza para agentes que não
compartilham estado interno é o **bastão escrito** — um briefing em prosa que o próximo recebe no
lugar do histórico. Vale registrar que nenhum harness usa hoje a retomada nativa da própria CLI:
`grep` por `--resume` e `--continue` em `motor/tmd/harness/` não devolve nada.

**Segunda, e essa é o achado: o bastão escrito já existe, embrionário, e ninguém o chama de handoff.**
`motor/cic/rpr/tentativas.ts:52-57` persiste cada tentativa em `cards/runs/<id>.attempts.json` com
até 8000 caracteres de resposta, e `attemptHistory` (`motor/cic/corrigir.ts:67-72`) reinjeta isso no
prompt da tentativa seguinte, truncado em 200 caracteres por linha, sob a frase "Historico de
tentativas anteriores neste card (NAO repita os mesmos erros; leve o feedback em conta)". É
**agnóstico de provedor** e roda no caminho de `CORRECTING` (`:75`). Não foi desenhado para
revezamento, mas é exatamente a forma certa: estado da tarefa em texto neutro, mais o worktree
carregando o que de fato mudou.

**Terceira: a única troca de provedor que o motor faz hoje é invisível para a função que existe
para observá-la.** `motor/euc/ias-da-sessao.ts:189-201` tem `trocasDeProvedor(chamadas)`, que lê
troca de provedor dentro de uma sessão. Só que sessão, ali, é por **execução**, não por card:
`idDaSessao` monta `<card>-<carimbo>` com carimbo de precisão de segundo (`:23-29`), e `abrirSessao`
sobrescreve o registro anterior (`:41-46`). Some-se a isso o fallback de cota
(`motor/osw/executar.ts:309-314`): ele grava `provider_override_implement` e **retorna sem mudar o
status**. O card continua em `EXECUTING`, a fila o redespacha, `handleExecute` chama `abrirSessao` de
novo — e as duas chamadas, a que falhou por cota e a que rodou no provedor novo, caem em **ledgers
diferentes**. `trocasDeProvedor` nunca vê nenhuma das duas pontas junta. O próprio teste do módulo
diz isso no título: `test/euc/ias-da-sessao.test.ts:35-43`, "a sessao de um card e estavel entre
chamadas, e uma nova execucao abre outra".

Some-se ainda que o escritor da escolha de provedor está do lado errado da costura
(`motor/mir/escolher-ia.ts`), que o `provider_override_implement` tem um único escritor de produção
(`motor/osw/executar.ts:312`) e que `implement` (`motor/cic/agente.ts:187`) não aceita override por
parâmetro — lê do frontmatter em `:190`. O daemon não troca de IA no meio de um card porque a
capacidade de escolher nunca esteve no motor.

**O que fazer, em ordem, e onde mexer.**

1. Fazer a sessão cobrir o card, e não a execução. `abrirSessao` (`euc/ias-da-sessao.ts:41`) passa a
   reaproveitar a sessão existente do card em vez de abrir outra. É o pré-requisito de tudo: sem
   isso, nenhuma leitura de travessia entre provedores é confiável, inclusive a que já existe.
2. Fazer o fallback de cota mudar o status ao retornar (`osw/executar.ts:309-314`). Hoje ele é um dos
   `return` sem transição que a PENDÊNCIA anterior sobre laço quente já enumera — e é o mesmo defeito.
3. Promover `attemptHistory` a briefing de passagem explícito: um campo no card dizendo qual provedor
   escreveu cada tentativa, para o texto reinjetado dizer de quem veio o bastão. `Fields` é
   `Record<string, string>` (`motor/cdl/tipos.ts:11`), então campo novo não muda tipo.
4. Levar a escolha de provedor para o motor, deixando `mir/escolher-ia.ts` como cliente.

**O que fica em aberto.** O contrato de sessão completo foi escrito três vezes e reprovado nas três
pelo crivo — não por otimismo sobre o handoff, que foi corretamente recusado nas três, mas por erros
de fato em cima da premissa de que a sessão já cobria o card. Corrigido o item 1 acima, o desenho
volta a ser possível sobre terreno verdadeiro. Também fica em aberto a incorporação dos comandos
nativos de cada IA: `motor/tmd/map/comandos.ts` já enumera manifestos `.md` por provedor, mas
`comandosDaIaAtiva` (`:137`) olha só `providerNameFor('implement')`, nunca mescla provedores, e não
tem namespace — o dedup em `:113` é um `Set` dentro da lista de um provedor só. `ollama` não tem
entrada em `FONTES`, e não está decidido se é lacuna ou escolha. O precedente de namespace já existe
no repositório: `MCP_PREFIX` em `motor/tmd/pnt/mcp.ts:6`.


---

## PENDÊNCIA — o motor desfaz a parada humana, e a sonda cura o que não diagnosticou

Três mecanismos independentes que produzem o mesmo sintoma — "a tarefa ficou travada
em loop" — e que a rodada do PR #28 **não** corrigiu. Ficam aqui com âncora porque
cada um é trabalho próprio, e o primeiro é o mais grave do repositório hoje.

**1. `updateCard` grava sem compare-and-set.** `motor/cdl/store.ts:43-65` é o único
ponto de escrita de card, e ele conhece o par (estado anterior, estado novo) — a
linha 54 chama `conferirTransicao(before.status, resolvedFields.status, id)`. Só que
o retorno é **ignorado**: `conferirTransicao` observa, registra a deriva e devolve;
o laço logo abaixo escreve `fm[k] = v` de qualquer jeito. Há `withFileLock`, então
não é corrida de escrita — é ausência de política. Ninguém pergunta "esta transição
é permitida a partir do estado que eu li?" nem "o card ainda está onde eu esperava?".

Consequência medida, no card 001 em disco: `17:17:08 CORRECTING->HALTED parado pelo
humano`, e às `17:20:30` o mesmo card volta para `URL` pela mão de
`motor/cic/corrigir.ts:126-134` — o job que já estava em voo terminou e escreveu por
cima. **Toda parada humana durante um job em voo é silenciosamente desfeita.** Para
quem está olhando a TUI, isso é exatamente "eu mandei parar e ele continuou".

O conserto não é barrar transição não declarada em produção — isso trocaria deriva
silenciosa por card travado, e o comentário de `motor/nmy/deriva-de-transicao.ts`
já diz isso. O conserto é o job em voo **reler o estado antes de escrever** e desistir
quando o card saiu de baixo dele, que é o que `HALTED` e `PAUSED` significam.

**2. A sonda de saúde não tem relação causal com a falha que ela libera.**
`motor/cic/rpr/espera.ts:69` chama `probeProviderHealth(provider)`, que cai em
`motor/tmd/registro.ts:112-115` — e ali harness desconhecido devolve `true`
incondicionalmente. Quando o harness é conhecido, a sonda é
`alcancavelPorHttp` (`motor/tmd/sonda.ts:8-16`), que faz `curl` numa URL e aceita
`code > 0 && code < 500`: **429 e 403 contam como saudável.**

Card 002 é a prova: entrou em `WAITING` às 13:20:03 por *timeout de 900s do CLI*, e
às 13:20:33 foi acordado com "sonda de saude ok". Um GET de cinco segundos numa URL
declarou curado um binário que não respondeu em quinze minutos. O que falhou e o que
foi medido não têm relação nenhuma — e o card volta para a fila para falhar de novo,
que é a forma mais cara possível de loop.

**3. `resume_from` atravessa a correção e faz o fecho pular todos os passos.**
`motor/euc/metricas-de-fecho.ts:57` grava `resume_from: RESUME_POST_STEPS` ao pausar
para confirmação. Se o humano responde "não resolveu", `motor/mir/acoes.ts:145-149`
manda o card para `CORRECTING` **sem limpar o campo**, e o fluxo de sucesso de
`motor/cic/corrigir.ts` também não limpa. Quando o card volta a `URL_OK`,
`motor/qlb/ctr/fechar.ts:92-93` lê `resume_from` e o repassa a `resumeStart`
(`motor/qlb/ctr/retomar.ts:9`), que devolve `steps.length` — e o `for` de
`fechar.ts:200` **itera zero vezes**. O card sai "polido" sem ter rodado passo nenhum.

Precisão importante: `fechar.ts:93` limpa o campo ao lê-lo, então o pulo acontece uma
vez só, não para sempre. Uma vez basta — é justamente o card que voltou da correção,
o que mais precisa dos passos, que os perde.

**Onde mexer, em ordem:** o item 1 primeiro, porque enquanto ele existir qualquer
parada é ilusória e os outros dois são difíceis de observar. Depois o 2, trocando a
sonda por uma que meça o que falhou (o binário, não uma URL) e que trate 429 como
indisponível. O 3 é uma linha em cada handler do meio.

---

## ESTADO — as duas trilhas de teste, e o que ainda separa uma da outra

A trilha `bun test` estava **quebrada por defeito próprio**, e foi consertada.
`test/apoio/runner.ts` se anunciava como fachada sobre `bun:test` e `node:test`, mas
importava **só** `node:test`. Rodando sob `bun test`, a suíte usava o *shim* de
`node:test` do Bun em vez do runner nativo — e esse shim tem a guarda
`checkNotInsideTest`, que proíbe registrar teste enquanto outro roda. Como **140 dos
248 arquivos** fazem `await import(...)` no topo, o módulo suspende, o runner começa
a executar o que já registrou, e quando o módulo volta para chamar `test()` a guarda
dispara. Eram 125 erros, e só **1566 dos 2704** testes chegavam a rodar.

A fachada passou a escolher o runner nativo de cada plataforma em tempo de execução.
Medido depois do conserto: **2710 testes rodados, 2708 passando**.

O conserto expôs dois defeitos que a trilha node não podia ver, ambos corrigidos:

- **`classifyFailure` não reconhecia binário ausente sob Bun** — e Bun é o runtime em
  que o motor de fato roda (`.bun-version`, `bin/hii.ts`). O padrão em
  `motor/cic/rpr/classe-de-falha.ts:16` cobria `ENOENT` (a forma do node) e não
  `Executable not found in $PATH` (a forma do bun). Em produção, provedor não
  instalado caía na última linha do classificador e o operador lia "falha nao
  reconhecida" em vez do motivo real. O teste que devia pegar isso amarrava a
  asserção à string do node.
- **A pós-condição da tarefa-ouro dependia de quem hospedava a suíte.**
  `test/osw/tarefa-ouro.test.ts` rodava a suíte do repo-alvo com `process.execPath`,
  que sob `bun test` é o bun. A pós-condição mecânica media o runner, não o trabalho
  da IA — o contrário do que uma tarefa-ouro existe para medir.

### O que ainda separa as duas trilhas

**1. Teste de socket falha se rodar tarde no processo.** `node --test` dá um processo
por arquivo; `bun test` roda os 248 num processo só. Qualquer teste que sobe servidor
HTTP passa isolado e falha quando roda no fim da fila — provado por ordenação: com
`test/euc/` primeiro, os três testes de `/health` passam e passa a falhar
`com porta configurada, o servidor sobe e responde de verdade`, que aí roda tarde.
Não há erro de `listen`, e `pronto` resolve no evento `listening`, com porta válida —
o `fetch` seguinte é que é recusado. É degradação do shim de `node:http` do Bun com
muitos handles abertos, não defeito de lógica do motor nem dos testes.

O caminho não é enfraquecer os testes. É dar isolamento por arquivo à trilha bun
(fatiar `test:unit`), ou assumir `bun run test:node` como critério canônico e dizer
isso no `package.json`, que hoje declara `test` apontando para a trilha que quebra.

**2. O pino de versão.** `.bun-version` pede 1.4.0 e o teste
`a versao do bun em uso e a pinada` existe justamente para acusar divergência. Numa
máquina com 1.3.14 ele falha por desenho, e é possível que parte do item 1 acima
desapareça em 1.4.0 — não foi medido.

**Instabilidade por carga.** `test/mir/tempo-de-pintura.test.ts` e
`test/mir/tui-sob-carga.test.ts` medem tempo absoluto de parede e ficam vermelhos com
a máquina carregada — observado com *load average* 22, verde de novo com 12, mesmo
código. A `RECOMENDAÇÃO` sobre `truncVisible` acima já aponta a saída: asserção por
**razão** entre dois tamanhos, não por milissegundo. Isso deixa de ser detalhe agora
que existe suíte E2E paralela: ela satura a máquina e derruba testes que não têm nada
a ver com ela.

---

## PENDÊNCIA — o que ficou em aberto no cassete e na trilha cara

O PR #28 entregou `test/apoio/cassete.ts` e `test/apoio/e2e.ts`, e corrigiu dois
defeitos que o crivo confirmou (o modo `regravar` destruía sequência multi-chamada; o
teto de gasto era inutilizável com `codex` e `kimi`, que declaram
`reportsCostUsd:false`). Ficou em aberto, tudo apontado pelo crivo e nenhum corrigido:

- **O gravador nunca consulta o teto.** `test/apoio/cassete.ts` grava e
  `test/apoio/e2e.ts` conta gasto, mas a ligação entre os dois existe só como frase na
  mensagem de erro. Uma gravação nova pode estourar o teto sem que a rodada perceba.
- **`formatoVersao: 1` é gravado e nunca validado na leitura.** Cassete de formato
  antigo será lido como se fosse do formato corrente.
- **Gravação concorrente perde entrada.** É read-modify-write sem trava; dois testes
  gravando o mesmo arquivo em paralelo derrubam um ao outro. Hoje ninguém faz isso, o
  que torna o defeito invisível até o dia em que alguém fizer.
- **`<DIR:n>` é posicional.** Repositórios diferentes que caem na mesma posição da
  lista colidem na mesma chave — dois pedidos distintos servidos pelo mesmo cassete.
- **O cassete envolve `Harness.run`, e é um degrau acima de onde o defeito mora.**
  A pesquisa que embasou o desenho já avisava: gravar `AgentRequest -> AgentResult`
  pula o parser de cada harness (`claude-stream.ts`, `codex.ts`), e foi exatamente num
  parser que o argv errado do kimi sobreviveu verde. Gravar stdout/stderr/exit-code do
  subprocesso exercitaria o parser de verdade, ao custo de uma costura por harness.
- **Não há como o motor receber o harness envolvido.** `motor/tmd/registro.ts:13-16` é
  `ReadonlyMap` const e os oito chamadores resolvem por `providerFor()` internamente.
  A costura de percurso que o repo de fato usa é `ExecuteDeps`
  (`test/osw/executar-custo.test.ts:51-54`) — é por ali que um teste ponta a ponta
  entra hoje, não envolvendo o harness.

---

## ESTADO — os cortes de custo da RECOMENDAÇÃO, e o que travou o quarto

Da ordem de corte registrada na `RECOMENDAÇÃO` acima, três entraram no PR #28, cada
um com teste que foi conferido dos dois lados:

1. **Feito.** O custo do passo e o da correção passam a ir para `cost_usd`/
   `tokens_total`, e não só para o texto do diário.
2. **Feito.** O teto de orçamento é conferido no topo do laço de passos
   (`motor/qlb/ctr/fechar.ts`), e não só na entrada do handler.
4. **Feito.** `motor/cic/passo-com-gate.ts` e `repararAteOTeto` comparam a assinatura
   do veredicto com a da volta anterior e param na primeira repetição. Dois testes que
   diziam medir o teto na verdade mediam isto — os roteiros repetiam a mesma frase
   em todas as voltas — e foram separados.

**O item 3 não entrou, e não é falta de código.** `config/model-tier.json` mapeia
**ação → tier** e não tem uma única linha ligando tier a provedor, modelo ou esforço.
`motor/osw/rui.ts:40-63` computa `EscolhaDeTier`, `registrarTier` manda para
`anexarEvento` e acaba ali. Decidir que `tier3_barato` é o `ollama` local — que roda
de graça em dólar — e que `tier1_caro` é o `claude` é decisão de negócio, não de
engenharia. Com o mapa escrito no arquivo de governança, o resto é ligar
`providerFor`/`modelFor`/`effortFor` ao tier já computado.

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
`motor/euc/ias-da-sessao.ts` — a matéria-prima existe), cota por cliente
(`motor/euc/tsr/orcamento.ts` tem teto por card) e limite de taxa.

**Sobre proteger o código, que foi a pergunta de origem:** se o produto virar uma API
medida, o cliente nunca recebe fonte e o servidor é a fronteira natural. Enquanto o
produto for o motor local, o caminho barato é compilar — o Bun gera executável único —
e não subir servidor nenhum.

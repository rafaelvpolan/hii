# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

**Podado em 29/08/2026.** Saiu daqui tudo o que foi conferido no código como feito:
as ondas D–H e as três rodadas de crivo, o roadmap dos 34 itens, `truncVisible`
(razão 417× → 0,98×, com teste de razão por tamanho de entrada em
`test/mirante/tui-sob-carga.test.ts:110-130`), a migração da suíte para `node:test`, a
evidência de RED pela opção 2, e os itens 1, 2 e 4 da ordem de corte de custo. O que
restou abaixo foi reconferido arquivo por arquivo — cada seção diz onde está a prova.

---

## PENDÊNCIA — o motor desfaz a parada humana, e a sonda cura o que não diagnosticou

Três mecanismos independentes que produzem o mesmo sintoma — "a tarefa ficou travada
em loop" — e que a rodada do PR #28 **não** corrigiu. Ficam aqui com âncora porque
cada um é trabalho próprio, e o primeiro é o mais grave do repositório hoje.

**1. `updateCard` grava sem compare-and-set.** `motor/cordel/store.ts:43-65` é o único
ponto de escrita de card, e ele conhece o par (estado anterior, estado novo) — a
linha 54 chama `conferirTransicao(before.status, resolvedFields.status, id)`. Só que
o retorno é **ignorado**: `conferirTransicao` observa, registra a deriva e devolve;
o laço logo abaixo escreve `fm[k] = v` de qualquer jeito. Há `withFileLock`, então
não é corrida de escrita — é ausência de política. Ninguém pergunta "esta transição
é permitida a partir do estado que eu li?" nem "o card ainda está onde eu esperava?".

Consequência medida, no card 001 em disco: `17:17:08 CORRECTING->HALTED parado pelo
humano`, e às `17:20:30` o mesmo card volta para `URL` pela mão de
`motor/ciclo/corrigir.ts:126-134` — o job que já estava em voo terminou e escreveu por
cima. **Toda parada humana durante um job em voo é silenciosamente desfeita.** Para
quem está olhando a TUI, isso é exatamente "eu mandei parar e ele continuou".

O conserto não é barrar transição não declarada em produção — isso trocaria deriva
silenciosa por card travado, e o comentário de `motor/niemeyer/deriva-de-transicao.ts`
já diz isso. O conserto é o job em voo **reler o estado antes de escrever** e desistir
quando o card saiu de baixo dele, que é o que `HALTED` e `PAUSED` significam.

**2. A sonda de saúde não tem relação causal com a falha que ela libera.**
`motor/ciclo/reprise/espera.ts:69` chama `probeProviderHealth(provider)`, que cai em
`motor/tomada/registro.ts:112-115` — e ali harness desconhecido devolve `true`
incondicionalmente. Quando o harness é conhecido, a sonda é
`alcancavelPorHttp` (`motor/tomada/sonda.ts:8-16`), que faz `curl` numa URL e aceita
`code > 0 && code < 500`: **429 e 403 contam como saudável.**

Card 002 é a prova: entrou em `WAITING` às 13:20:03 por *timeout de 900s do CLI*, e
às 13:20:33 foi acordado com "sonda de saude ok". Um GET de cinco segundos numa URL
declarou curado um binário que não respondeu em quinze minutos. O que falhou e o que
foi medido não têm relação nenhuma — e o card volta para a fila para falhar de novo,
que é a forma mais cara possível de loop.

**3. `resume_from` atravessa a correção e faz o fecho pular todos os passos.**
`motor/euclides/metricas-de-fecho.ts:57` grava `resume_from: RESUME_POST_STEPS` ao pausar
para confirmação. Se o humano responde "não resolveu", `motor/mirante/acoes.ts:145-149`
manda o card para `CORRECTING` **sem limpar o campo**, e o fluxo de sucesso de
`motor/ciclo/corrigir.ts` também não limpa. Quando o card volta a `URL_OK`,
`motor/quilombo/cartorio/fechar.ts:92-93` lê `resume_from` e o repassa a `resumeStart`
(`motor/quilombo/cartorio/retomar.ts:9`), que devolve `steps.length` — e o `for` de
`fechar.ts:200` **itera zero vezes**. O card sai "polido" sem ter rodado passo nenhum.

Precisão importante: `fechar.ts:93` limpa o campo ao lê-lo, então o pulo acontece uma
vez só, não para sempre. Uma vez basta — é justamente o card que voltou da correção,
o que mais precisa dos passos, que os perde.

**Onde mexer, em ordem:** o item 1 primeiro, porque enquanto ele existir qualquer
parada é ilusória e os outros dois são difíceis de observar. Depois o 2, trocando a
sonda por uma que meça o que falhou (o binário, não uma URL) e que trate 429 como
indisponível. O 3 é uma linha em cada handler do meio.

---

## PENDÊNCIA — o card trava porque há estado sem consumidor, e o laço não sabe que não progride

A máquina de estados tem 15 estados; apenas 5 têm consumidor automático dentro do tick
(`motor/oswaldo/mutirao/fila.ts:97-100`, `pending()` → handlers). Os outros 10 são checkpoints
humanos, estados de boot ou — o pior — estados que nunca saem sozinhos. Card 001 está
em `URL` desde 19/08. Card 002 em `HALTED` sem sinal de por quê. Ambos têm `updated`
recente porque cada log que cai escreve `fm.updated = isoNow()` (`motor/cordel/store.ts:58`),
mascarando staleness.

`reconciledStranded()` (`motor/oswaldo/mutirao/estado-da-fila.ts:44-52`) roda uma única vez no
boot, assume que um card é órfão se não está em estado terminal conhecido, e **refuta**
estados reais: `URL`, `CLARIFY`, `READY`, `PAUSED`, `CONFIRM`, `HALTED` — os seis que
o motor hoje **não consegue destravar**. A lista `checkpointsHumanos` em `config/topologia.json:74`
declara `["URL","CONFIRM","PR_OPEN"]`, e o teste `test/niemeyer/topologia.test.ts:110-121` valida
a cadeia de estados per-perfil, nunca a decisão de "quem espera humano". De fato `PR_OPEN`
**tem** consumidor (`motor/quilombo/cartorio/merge.ts:39`, roda a cada 30 s) — o único checkpoint
que o motor tira sozinho. Três dos quatro checkpoints reais (`READY`, `CLARIFY`, `PAUSED`)
não estão na lista.

**O laço quente, o problema concreto:**

`handleExecute` (`motor/oswaldo/executar.ts:309-314`) em falha de cota de provedor devolve sem
mudar status — o card fica em `EXECUTING`. Redespachado em ≤5 s porque `fila.ts` não tem
cooldown por card (`:97-100` só filtra `emVoo`, `:31` só reveza na chamada). `provider_override_implement`
(`executar.ts:312`) é gravado mas **nunca apagado** — grep mostra escritor único em `:312`,
zero leitores de limpeza. Card cravado no fallback para sempre. Se a cota original reset,
o override continua ativo.

Em outro caminho, `quotaFallbackProviderFor` (`motor/tomada/registro.ts:134-137`) é chamado em
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
(`motor/cordel/alicerce/config.ts:60-62`) dá **três voltas** no laço de `motor/ciclo/passo-com-gate.ts:64`, e
cada volta custa uma chamada do agente mais até duas do crivo (`GATE_RETRIES` = 1, `config.ts:64`)
— nove chamadas por passo gated, vinte e sete nos três passos gated, mais o passo não gated.
Resultado: **ordem de centenas de chamadas de IA por card, dentro dos tetos declarados, sem
ninguém intervindo, todas podendo voltar sem progresso**. O multiplicador exato depende de quantas
retomadas de espera cada fronteira de passo concede na prática, e essa medição não foi feita —
o que está provado é a ordem de grandeza e o fato de nenhuma delas bater no teto. Card 002 prova: `13:20:03 EXECUTING->WAITING (tentativa 1/8)` e `13:20:33
WAITING->EXECUTING sonda de saude ok` — um timeout de 900 s do CLI foi "curado" por um GET
de 5 s no host da API, porque `probeProviderHealth()` (`motor/tomada/sonda.ts:14`) retorna `true`
para qualquer código `> 0 && < 500` — código 429 conta como saudável. `wait_provider` vazio
devolve `true` incondicional.

**Deriva de transição:** `config/topologia.json:9-46` declara pares (origem, destino). `planSteps`
(`motor/oswaldo/rota/perfil.ts:227-242`) combina perfil + pipeline, produzindo **6 pares não declarados**:
`URL_OK→TESTS_GREEN`, `URL_OK→CLEANED`, `URL_OK→SEC_CLEARED`, `REFINED→SEC_CLEARED`, `REFINED→CLEANED`,
`TESTS_GREEN→CLEANED`. Quatro são heurísticos, dois foram observados. O teste `topologia.test.ts:110-121`
valida o pipeline **completo**; nunca chama `planSteps` para cada perfil ativo.

**Onde mexer:**

- `motor/cordel/store.ts:53` — adicionar campo `status_since` (gravado só quando o status muda,
  não em todo `patchCard`). Habilita staleness real e timeout de checkpoint.
- `motor/ciclo/reprise/politica.ts:72` — antes do `if (input.failureClass === 'quota')`, branch para um
  roteador que decide troca (seção PLANO abaixo).
- `motor/tomada/registro.ts:134-137` — `quotaFallbackProviderFor` deixa de ser chamada aqui; a
  decisão de rota integrada no roteador a substitui. O override é limpo em `executar.ts:372`
  (implement bem-sucedido).
- `motor/oswaldo/rota/perfil.ts` — somar os 6 pares a `topologia.json`; `topologia.test.ts:110-121`
  passa a varrer `planSteps(perfil)` para cada perfil ativo, não só o pipeline.
- `motor/ciclo/crivo/url-viva.ts:56-62` — `ensureUrl` já confere URL viva; criar consumidor em
  `motor/oswaldo/mutirao/fila.ts:83` (`podar()`) que reconfire `url_pid` mortos e marca `url_estado`.
- `motor/oswaldo/mutirao/fila.ts:29` — o catch-all de `runJob` manda pra `HALTED` sem `halt_class`.
  Todas as ~26 escritas de HALT precisam de classe (`transient`/`quota`/`terminal`/`humano`/`orcamento`/`excecao`).

**O que fica em aberto:**

Prioridade de qual laço sair do travamento: se o roteador (PLANO) destravar a quota, a contagem
falsa de tentativas fica em segundo plano — o card terá mais oportunidade antes de HALT. Se
corrigir `cost_usd` no frontmatter (RECOMENDACAO item 3), o teto de orçamento deixa de ser
decorativo. Ambos são pré-requisitos para o terceiro: detecção de não-progresso (item 5 em
CORVINUS, hash de `gate.reason` entre voltas).

**Reconferido em 29/08:** o terceiro pré-requisito citado acima — detecção de
não-progresso — **já foi feito** e saiu da lista: `motor/ciclo/reparo.ts:48-50`
(`assinaturaDeVeredicto`) e `:84-93` comparam a volta anterior e quebram o laço, e
`motor/ciclo/passo-com-gate.ts:60,136-141` fazem o mesmo antes do teto de `maxReajuste()`.
O que continua aberto nesta seção é o resto: `status_since` (zero ocorrências no
repositório), `halt_class` (2 escritores contra ~26 escritas de `HALTED`),
`provider_override_implement` sem limpador, os 6 pares de transição fora de
`topologia.json`, e a ausência de cooldown por card em `motor/oswaldo/mutirao/fila.ts`.

---

## PLANO — transformar motor/tomada/registro de harnesses em roteador de rotas

O contrato `Harness` já declara capacidade em dois lugares: `capabilities()` devolve
`HarnessCapabilities` com seis booleanos (`restrictsTools`, `isolatesReadonly`, `acceptsEffort`,
`reportsCostUsd`, `reportsTokens`, `mcp`) — `motor/tomada/tipos.ts:56-63` — e o próprio `Harness`
declara `supportsAgents`, `supportsVision` e `agentic` como campos, `motor/tomada/tipos.ts:101-105`.
São dados de capacidade que já existem; o que falta é alguém consultá-los para decidir rota.
Hoje só `isolatesReadonly` é lido, em `motor/euclides/tesouro/confianca.ts:74-82`.
A classe de erro já é normalizada por harness (`sinaisDeFalha()`, `:47-51`) e `classifyFailure`
(`motor/ciclo/reprise/classe-de-falha.ts:43-53`) cruza com genéricos. `probeProviderHealth()`
(`motor/tomada/registro.ts:112-115`) existe mas é **lido só por `espera.ts:69`** — nunca para escolher.
`TrocaDeProvedor` (`motor/cordel/tipos.ts:76-81`) é tipo que nada preencheu. O roteador que falta
é um decisor aditivo (nunca piora o comportamento atual, só acrescenta uma saída antes do HALT),
chamado de dentro de `decideOutcome` (`motor/ciclo/reprise/politica.ts:72`).

**Assinatura concreta, sem dependência nova:**

```ts
// motor/tomada/rota.ts — novo arquivo, só imports de tomada/
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
   (`motor/tomada/preferencias.ts:13-25`, extensão retrocompatível do campo `provider` singular).
   Fallback: `providerNames()` (os quatro conectados).
3. Filtra por `tentadosNestaRodada` (não repetir quem falhou ESTA rodada), por `capabilities()`
   (papel `implement` exige `agentic`, papel `verify` exige `isolatesReadonly` — regra que já
   existe em `motor/euclides/tesouro/confianca.ts:74-82`, hoje só para recusar), por `autenticado()`,
   por `janelasDoProvedor` (cota estourada, `motor/tomada/disponibilidade.ts:28-31`).
4. Ordena preferindo `rodaLocal` quando mecânico (papel `step`/`verify` sem escrita).
5. Lista vazia → `manter_politica_atual`. Nunca piora.

**Encaixe em pontos concretos (sem redesenho):**

- `motor/ciclo/reprise/politica.ts:72` — antes do `if (input.failureClass === 'quota')`, branch:
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
- `motor/tomada/preferencias.ts` — campo novo `providers?: string[]` é opcional; código existente
  que usa `provider` singular segue funcionando.
- Campo novo `rota_tentados` no frontmatter do card (CSV de HarnessId) — escrito por `patchCard`,
  limpo por `haltFields` (item 15 em Rufus) e pelo sucesso.

**O que já passa a funcionar com esse roteador mínimo:**

Failover de quota entre claude↔codex↔kimi para `implement`; entre claude↔codex↔ollama para `verify`.
Card em `EXECUTING` com quota de claude redirecciona para codex no mesmo tick. Tiering de modelo
(próximo item, RECOMENDACAO) passa a ser consultável no ponto de escolha.

---

## RECOMENDAÇÃO — onde o dinheiro queima, agora medido no ledger e não estimado

Os itens 1, 2 e 4 da ordem de corte anterior entraram no PR #28 e saíram desta lista.
O que sobrou é o item 3 — e a medição abaixo, que não existia quando a ordem foi
escrita, muda a prioridade dele de "quando der" para "primeiro".

**Somando todo `cards/runs/*.ias.jsonl` em disco: 27 chamadas, US$ 19,80.**

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

**O item 3 continua parado, e continua sendo decisão de negócio, não de engenharia.**
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

---

## ESTADO — o que o motor não consegue ver quando um card para

Três achados de diagnosticabilidade, que explica por que card 001 em `URL` há 4 dias não grita e card 002
em `HALTED` não diz por quê. O script que responde `/health` faz `lerSaude()` → `{"ok":true,"encerrando":false,"emVoo":0,"pendentes":0,"falhasSeguidasNoTick":0,"ultimoErro":""}` porque
`recordTickSuccess()` zera o contador de falhas sempre que o `tick` não lança exceção — mesmo que nenhum
card tenha mudado de estado. Não há campo que meça "ciclos improdutivos seguidos".

`halt_class` é escrito em apenas 2 sítios (`motor/ciclo/reprise/espera.ts:36`, `politica.ts:35`) e lido em 1
(`motor/euclides/radar/saude.ts:115`). Os outros ~26 `HALT` (via `motor/mirante/acoes.ts:173`, `executar.ts:172,181,191,263,272,359`,
`corrigir.ts:90,94,104`, `fechar.ts:73,77,89,97,109,121,138,151,365,391`, `fase-spec.ts:45,56,80,85,100,113,117,124`,
`metricas-de-fecho.ts:44-49`) cravam `status: HALTED` sem classe. Card 002 (`cards/002-faca-outro-modelo-de-ranking-current-ses.md:4`)
prova: frontmatter sem `halt_class`, `halt_at`, `halt_reason`. O último log é texto livre. `porHalts`
ignora o card e retorna "ocioso". Motor responde verde.

`status_since` não existe no frontmatter. `updated` é gravado **incondicionalmente** em todo `patchCard`,
inclusive nos que não mudam campo nenhum (`motor/ciclo/passo-com-gate.ts:32,107,119`). Um card em laço de
reparo renova `updated` a cada log → idade aparente ≤ 2 min → invisível enquanto está laçando. Os
6 estados sem consumidor automático (`READY`, `CLARIFY`, `PAUSED`, `CONFIRM`, `HALTED`, `URL`) estão
ausentes de `isActive()` (`motor/mirante/render/phases.ts:34-36`) — nenhum deles aparece em rodapé com
idade. Lista "esperando você" não tem coluna de tempo. Um card em `URL` há 4 dias renderiza idêntico a
um lá há 4 segundos.

O tipo `'human_checkpoint'` de evento existe em `TIPOS_DE_EVENTO` (`motor/euclides/eventos.ts:19`) e é citado
como implementado em docs, mas **grep encontra zero emissores** de `anexarEvento` com esse tipo. `checkpointsHumanos`
em `config/topologia.json:74` está tipado e parseado, com zero consumidores de produção. Nada sabe que
`URL` *é* checkpoint, nada pode ter timeout.

**Sinal que falta, em ordem de impacto:**

1. `status_since` no frontmatter — gravado só quando status muda (não em todo `patchCard`). Em
   `motor/cordel/store.ts:53`, onde já há `resolvedFields.status !== undefined` e chamada de `conferirTransicao`.
2. `halt_class` obrigatório em toda escrita `HALTED` — com classes novas (`humano`, `excecao`, `orcamento`,
   `escopo`) para casos hoje mudos. Ponto de estrangulamento único: `motor/cordel/store.ts:43-65` confere
   status antes de gravar; ali se recusa/carimba HALT sem classe.
3. Evento `human_checkpoint` emitido **no ponto de entrada** do checkpoint (`motor/cordel/store.ts:53`,
   onde já se sabe se é transição) com `chave` = status e `resultado` = `aberto`. Emitido também na
   **saída** (`motor/mirante/acoes.ts:81-90` approveUrl, `acoes.ts:115-125` confirmar, `motor/quilombo/cartorio/merge.ts:23`
   fechado) com `resultado` = `atendido`.
4. Tick sem progresso detectável — em `motor/oswaldo/mutirao/fila.ts:105`, comparar assinatura de estado da
   fila (par `id:status` de `allCards()`) contra tick anterior. Gravar `ticksSemProgresso` em
   `motor/euclides/radar/tick.ts:6-10` (`DaemonHealth`). `/health` degrada para 503 (ou `ok:false`) quando
   motor está de pé e improdutivo.
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

## DECISÃO — o que fica no bun, o que fica no node, e o que hoje está no lugar errado

Levantado por varredura de `motor/`, `bin/`, `scripts/`, `runner.ts`, `Dockerfile`,
`.github/workflows/ci.yml` e `package.json`, com os tempos medidos nesta máquina
(node v24.17.0, bun 1.4.0).

**O ponto de partida é melhor do que parecia: o núcleo já é neutro.** Grep por `Bun.`,
`bun:`, `import.meta.dir` e afins em `motor/` + `bin/` + `scripts/` + `runner.ts`
devolve **zero**, e isso não é sorte — é invariante em
`test/cordel/alicerce-runtime.test.ts:60-64`. `motor/cordel/alicerce/runtime.ts:47-62` já escolhe o
runtime por `HICODE_RUNTIME`, com detecção automática e memoização (`:40-51`, porque a
TUI consulta a cada ~400 ms). Os 983 imports relativos de `motor/`+`bin/` carregam
extensão `.ts` explícita — 983 de 983, guardado por
`test/cordel/import-com-extensao.test.ts:41-59`. Não há dependência de runtime no
`package.json`: só devDeps.

**Portanto a pergunta não é "reescrever para bun ou para node".** É onde cada um paga,
e o que hoje está fora do lugar.

### Onde o bun paga, medido

| Superfície | Medida | Decisão |
|---|---|---|
| Arranque do CLI/TUI interativo | `bin/hii.ts --help`: **bun 0,03 s × node 0,15 s** (5×) | **bun**, que já é o default local por detecção |
| Binário único distribuível | `bun build --compile` não tem equivalente prático no node | **bun**, e é o caminho barato de "proteger o código" citado na última seção |
| Instalação de dependências no CI | `bun install --frozen-lockfile` já é o passo (`ci.yml:32`) | **bun** |

### Onde o node paga, medido

| Superfície | Medida | Decisão |
|---|---|---|
| Daemon de produção | imagem `node:24-slim`, `ENTRYPOINT ["node","bin/hii.ts"]` (`Dockerfile:4,54`), `HICODE_RUNTIME=node` (`:36`) | **node**. Foi o node que expôs o `setInterval` sem `unref` que prendia o processo — o bun ignora timer pendente ao sair, o node respeita, e o certo é o do node |
| Suíte de testes | `node --test` roda **2.704 testes em 32 s**, um processo por arquivo, em paralelo | **node é a trilha primária** |
| Scripts `.mjs` de lint e manutenção | ESM puro, `node:fs`/`node:path`; o prefixo `bun` em `package.json:15-17` é convenção, não necessidade | **node** |

### O que está no lugar errado hoje

1. **`scripts/runner-daemon.sh` exige `bun` e a imagem de produção não tem.** Ele
   hardcoda `bun` em três pontos — `:47` (reconhece o daemon só se a linha de comando
   for `bun runner.ts`), `:54` (`pgrep -x bun`) e `:101` (`nohup bun runner.ts`) — e é
   chamado por `bin/hii.ts:31` sem passar runtime. Com `COM_BUN=0`, que é o padrão do
   `Dockerfile:23`, **o container não tem `bun` e o daemon não sobe**. `runtimeDeScript()`
   existe exatamente para isso e não é usado aqui. É o defeito de runtime mais grave do
   repositório, e é de produção.

2. **A trilha bun é 2,5× mais lenta que a node, e a culpa não é do bun.**
   `scripts/test-bun.mjs:39-52` é um `for` com `spawnSync` — um arquivo por vez, sem
   concorrência nenhuma —, daí 1m22s contra os 32 s do `node --test`. Paralelizar esse
   laço pelo número de núcleos é a correção; o processo por arquivo tem de ficar, porque
   é o que dá o isolamento que a suíte precisa.

3. **`bun run test` não roda a trilha node.** `package.json:19` encadeia typecheck +
   `lint:types` + `lint:clone` + `test:unit` e para aí. O critério de verde local é
   mais fraco que o do CI (`ci.yml:43`), e essa diferença já custou uma imagem que
   morria no arranque com o CI verde.

4. **A trilha node depende de `bun` para passar.** `test/scripts-setup-imports.test.ts:18`
   spawna `bun build` para conferir resolução de import, e `package.json:18` só exclui
   `apoio/expect-diferencial` da lista. Rodar `bun run test:node` numa máquina sem bun
   reprova por ausência de binário, não por defeito.

5. **Dois scripts têm bloco de CLI que nunca executa sob node.**
   `scripts/renomear-brazil.mjs:244` e `scripts/renomear-testes-brazil.mjs:163` usam
   `if (import.meta.main)`, que é extensão do bun — sob node é `undefined`, e o bloco
   some em silêncio. É a forma de falha que este repositório mais persegue: o recurso
   morto que ninguém vê. `scripts/auditar.ts:126-128` documenta o mesmo comportamento
   sabendo dele.

6. **`require()` dentro de um `.mjs`.** `scripts/renomear-testes-brazil.mjs:207` faz
   `const { writeFileSync } = require('node:fs')` — `ReferenceError` em qualquer runtime
   se a linha for atingida. O invariante que proíbe isso
   (`test/apoio/migracao-node-test.test.ts:112-115`) varre só `test/`, nunca `scripts/`.

7. **Duas incoerências menores de configuração.** O `Dockerfile:27` copia `bun.lock` e
   o `:31` roda `npm install --omit=dev`, que o ignora — funciona só porque não há
   dependência de runtime. E `tsconfig.json:9` mapeia `#shared/*` para `./panel/*`, um
   diretório que não existe no repositório.

### O que NÃO fazer

Adotar `Bun.file`/`Bun.spawn`/`Bun.serve` no motor para "ganhar desempenho". O caminho
quente do motor é chamada de IA e comando de git: as 27 chamadas medidas levaram de 11 s
a 230 s cada. Trocar o custo de um `spawn` ali é ruído contra isso, e o preço seria
perder a neutralidade que hoje permite escolher o runtime por superfície — que é
justamente o que esta seção usa.

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
`grep` por `--resume` e `--continue` em `motor/tomada/harness/` não devolve nada.

**Segunda, e essa é o achado: o bastão escrito já existe, embrionário, e ninguém o chama de handoff.**
`motor/ciclo/reprise/tentativas.ts:52-57` persiste cada tentativa em `cards/runs/<id>.attempts.json` com
até 8000 caracteres de resposta, e `attemptHistory` (`motor/ciclo/corrigir.ts:67-72`) reinjeta isso no
prompt da tentativa seguinte, truncado em 200 caracteres por linha, sob a frase "Historico de
tentativas anteriores neste card (NAO repita os mesmos erros; leve o feedback em conta)". É
**agnóstico de provedor** e roda no caminho de `CORRECTING` (`:75`). Não foi desenhado para
revezamento, mas é exatamente a forma certa: estado da tarefa em texto neutro, mais o worktree
carregando o que de fato mudou.

**Terceira: a única troca de provedor que o motor faz hoje é invisível para a função que existe
para observá-la.** `motor/euclides/ias-da-sessao.ts:189-201` tem `trocasDeProvedor(chamadas)`, que lê
troca de provedor dentro de uma sessão. Só que sessão, ali, é por **execução**, não por card:
`idDaSessao` monta `<card>-<carimbo>` com carimbo de precisão de segundo (`:23-29`), e `abrirSessao`
sobrescreve o registro anterior (`:41-46`). Some-se a isso o fallback de cota
(`motor/oswaldo/executar.ts:309-314`): ele grava `provider_override_implement` e **retorna sem mudar o
status**. O card continua em `EXECUTING`, a fila o redespacha, `handleExecute` chama `abrirSessao` de
novo — e as duas chamadas, a que falhou por cota e a que rodou no provedor novo, caem em **ledgers
diferentes**. `trocasDeProvedor` nunca vê nenhuma das duas pontas junta. O próprio teste do módulo
diz isso no título: `test/euclides/ias-da-sessao.test.ts:35-43`, "a sessao de um card e estavel entre
chamadas, e uma nova execucao abre outra".

Some-se ainda que o escritor da escolha de provedor está do lado errado da costura
(`motor/mirante/escolher-ia.ts`), que o `provider_override_implement` tem um único escritor de produção
(`motor/oswaldo/executar.ts:312`) e que `implement` (`motor/ciclo/agente.ts:187`) não aceita override por
parâmetro — lê do frontmatter em `:190`. O daemon não troca de IA no meio de um card porque a
capacidade de escolher nunca esteve no motor.

**O que fazer, em ordem, e onde mexer.**

1. Fazer a sessão cobrir o card, e não a execução. `abrirSessao` (`euclides/ias-da-sessao.ts:41`) passa a
   reaproveitar a sessão existente do card em vez de abrir outra. É o pré-requisito de tudo: sem
   isso, nenhuma leitura de travessia entre provedores é confiável, inclusive a que já existe.
2. Fazer o fallback de cota mudar o status ao retornar (`oswaldo/executar.ts:309-314`). Hoje ele é um dos
   `return` sem transição que a PENDÊNCIA anterior sobre laço quente já enumera — e é o mesmo defeito.
3. Promover `attemptHistory` a briefing de passagem explícito: um campo no card dizendo qual provedor
   escreveu cada tentativa, para o texto reinjetado dizer de quem veio o bastão. `Fields` é
   `Record<string, string>` (`motor/cordel/tipos.ts:11`), então campo novo não muda tipo.
4. Levar a escolha de provedor para o motor, deixando `mirante/escolher-ia.ts` como cliente.

**O que fica em aberto.** O contrato de sessão completo foi escrito três vezes e reprovado nas três
pelo crivo — não por otimismo sobre o handoff, que foi corretamente recusado nas três, mas por erros
de fato em cima da premissa de que a sessão já cobria o card. Corrigido o item 1 acima, o desenho
volta a ser possível sobre terreno verdadeiro. Também fica em aberto a incorporação dos comandos
nativos de cada IA: `motor/tomada/mapa/comandos.ts` já enumera manifestos `.md` por provedor, mas
`comandosDaIaAtiva` (`:137`) olha só `providerNameFor('implement')`, nunca mescla provedores, e não
tem namespace — o dedup em `:113` é um `Set` dentro da lista de um provedor só. `ollama` não tem
entrada em `FONTES`, e não está decidido se é lacuna ou escolha. O precedente de namespace já existe
no repositório: `MCP_PREFIX` em `motor/tomada/ponte/mcp.ts:6`.

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
- **Não há como o motor receber o harness envolvido.** `motor/tomada/registro.ts:13-16` é
  `ReadonlyMap` const e os oito chamadores resolvem por `providerFor()` internamente.
  A costura de percurso que o repo de fato usa é `ExecuteDeps`
  (`test/oswaldo/executar-custo.test.ts:51-54`) — é por ali que um teste ponta a ponta
  entra hoje, não envolvendo o harness.

---

## ESTADO — o que ficou aberto nas duas trilhas de teste

As duas trilhas passam (`bun run test:unit` e `bun run test:node`), e os três defeitos
que impediam isso saíram desta lista com o PR #28. O que continua aberto:

- **75 arquivos de teste escrevem `process.env` no topo do módulo** (124 ocorrências).
  O isolamento por processo — um processo por arquivo nas duas trilhas — as torna
  inofensivas, **não corretas**. Se algum dia a suíte rodar em processo compartilhado,
  elas voltam a morder. Exemplos: `test/mirante/tui-sob-carga.test.ts:15`,
  `test/mirante/tempo-de-pintura.test.ts:29-31`.
- **Duas asserções ainda medem milissegundo absoluto**, e ficam vermelhas com a máquina
  carregada (observado com *load average* 22, verde de novo com 12, mesmo código):
  `test/mirante/tempo-de-pintura.test.ts:29-31` (`TETO_QUADRO_MS`, `TETO_QUADRO_CJK_MS`,
  `TETO_PINTURA_MS`) e `test/mirante/tui-sob-carga.test.ts:15` (`TETO_MS`). As duas já
  convivem com asserções por **razão** nos mesmos arquivos, que é a forma estável — a
  absoluta é deliberada e sobrescrevível por env, mas é ela que derruba a suíte quando
  a trilha E2E satura a máquina em paralelo.
- **`.bun-version` pede 1.4.0**: rodar com outra versão faz
  `test/cordel/scripts-existem.test.ts` acusar, por desenho. O pino é do CI
  (`ci.yml:20-22`) e existe porque `expect([NaN]).toContain(NaN)` passa no bun 1.3.14
  (SameValueZero) e falha no 1.4.0 (`===`).

---

## ESTADO — o que está atrás de `HICODE_RIGOR_ESTRITO=1`

Decidido: **LIGAR**. O interruptor é `HICODE_RIGOR_ESTRITO=1` no ambiente — não há
mudança de código a fazer, e por isso ligar é ato de operação, não de commit: quem
liga escolhe o momento em que os cards em voo podem parar.

O que mudou nesta rodada é que o interruptor ficou **utilizável de verdade**. O Chagas
(item 5) foi consertado na Onda C, e nesta rodada `test/agentes/chagas-red-primeiro.test.ts`
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

# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## RESPOSTA — `/end`: não faz sentido como comando, mas o seu instinto achou um defeito real

Você descreveu: *"começar outra tarefa/conversa com outro contexto, sem manter
memória anterior enviando tudo para IA"*.

**Não recomendo criar o `/end`**, por três motivos concretos:

1. **O card já é a fronteira de contexto.** Cada card roda no próprio worktree
   e monta o prompt do zero (`motor/cic/agente.ts`). Não existe conversa que
   atravesse cards — não há o que "encerrar".
2. **A TUI já tem `/new-session`** (`motor/mir/sessao.ts:58`), que faz
   exatamente "outra conversa, contexto limpo".
3. **A única coisa que de fato atravessa para o prompt da IA** é
   `.hii/memory/motor.md` (`motor/cic/agente.ts:167`) — e **já existe o
   interruptor** para não mandar nada: `HICODE_PROJECT_MEMORY=off`.

Um `/end` que apaga memória duplicaria esse interruptor e destruiria o rastro
que o `aprendiz` (item 12, Onda 10) foi desenhado para ler.

**Mas investigar isso achou um defeito de verdade, e eu corrigi.**
`readProjectMemory` cortava com `.slice(0, 2500)` — os 2500 caracteres **mais
antigos**. Como o arquivo cresce por append cronológico, a memória do projeto
**congelava no passado**: tudo que o motor aprendia depois nunca chegava ao
prompt, e nada avisava. Agora mantém o recente e declara quando corta
(`memoria truncada: N caracteres mais antigos omitidos`). Seu instinto estava
certo na direção — não era "manda tudo", era "manda a fatia errada, para
sempre, em silêncio".

**Se quiser mesmo um controle por card** — "este card não recebe memória
nenhuma" — isso é honesto e pequeno: um campo `memoria: off` no frontmatter,
lido no mesmo ponto onde `PROJECT_MEMORY` já é lido. Diga e eu faço; é uma
linha e um teste.


R: o /end seria para ele começar outra tarefa/conversa com outro contexto, sem manter memoria anterior enviando tudo para IA. Veja se faz sentido, caso contrario não faz.

---

## RECOMENDAÇÕES — os três itens que você mandou avaliar

### 1. Laço de conflito do `sync.ts` — NÃO migrar, mas fechar o buraco real

**Não migre para `repararAteOTeto`.** `GateReparavel` modela "roda uma
verificação → veredicto → conserto estreito → roda de novo". Resolução de
conflito não tem verificação re-executável: o "veredicto" é `git diff
--diff-filter=U` e o conserto edita os arquivos em conflito. Forçar no molde
compra uniformidade pagando com abstração errada.

**O buraco real é mais estreito.** Conferido: `motor/qlb/ctr/sync.ts` escreve
no log do card (`CONFLITO n/MAX`) e registra métrica de custo
(`addMetric(fsteps, 'Conflito', …)`), mas tem **zero** chamadas a
`anexarEvento`. Consequências concretas: `motor/euc/recuperar.ts` não enxerga
um laço de conflito interrompido por crash, e o `aprendiz` (item 12) não
conseguirá contar conflito recorrente como `ProblemSignature`.

**Recomendo:** emitir `repair_attempt` por tentativa e `gate_verdict` no fim.
Três linhas, nenhuma mudança de abstração, e resolve o que de fato falta —
invisibilidade, não falta de uniformidade.

R: fazer recomendação

### 2. Reduzir os tetos de reparo — medir antes de automatizar

**Os dois tetos já são ajustáveis sem código novo:**
`HICODE_REAJUSTE_RETRIES` e `HICODE_CONFLICT_RETRIES`, default 2 cada
(`motor/cdl/ali/config.ts:56-59`). Então "reduzir para builds cronicamente
instáveis" não precisa de implementação para ser *possível* — precisa de um
jeito de saber **quais** alvos são instáveis.

**Não recomendo construir o detector automático.** Ele exigiria limiar, política
de decaimento e armazenamento, e ainda seria um *proxy* para "isto está
custando demais" — que o `orcamentoPorCard.tetoUsd` (entregue nesta onda) já
mede direto, sem proxy.

**Recomendo:** contar `repair_attempt` por alvo no diário e mostrar em
`hii status`. Aí baixar o env para aquele alvo vira decisão sua com dado atrás.
**Depende do item 1 acima** — sem os eventos do `sync.ts`, o laço de conflito
fica fora da contagem, e ele é justamente um dos quatro pontos de reparo.

R: FAzer recomendação

### 3. Ligar `executarEmBlocos` — recomendo NÃO ligar agora, e parar de contar como pronto

O laço de polimento do `fechar.ts` **já** faz executa → valida → para cedo. Rotear
por TJL ali seria refatoração sem ganho de comportamento: cerimônia para dar um
chamador ao módulo e um ✅ ao roadmap, sem entregar economia nenhuma.

O valor real do TJL é fatiar **uma** chamada de implementação em blocos
validados (schema → migration → model → controller → teste). Mas o plano exige
que quem decide os blocos seja função determinística, nunca a IA — e essa
decisão é conhecimento **por stack**. Ou seja: o fatiador pertence à camada de
skill, não ao `core/`.

**Recomendo:** marcar o item 18 como *"mecanismo pronto, sem consumidor"* no
`WORKFLOW-EXECUCAO.md` em vez de fingir conclusão, e deixar o primeiro
consumidor chegar junto com o pack `backend-web` — o mesmo pack que o item 16
está esperando.

R: FAzer recomendação
---

## ESTADO — o que está atrás de `HICODE_RIGOR_ESTRITO=1`

Decidido: **manter como registro**, sem ligar. Três exigências já escrevem o
veredicto no card e só barram com o interruptor ligado:

| Item | Exige | Campo no card |
|---|---|---|
| 5 | perfil `completo` teve teste que FALHOU antes de passar | `red_antes_do_green` |
| 22 | área nova tem comando de teste no contrato do alvo | `setup_ferramental` |
| 4 | matriz de entendimento respondida antes de aprovar o plano | `matriz_entendimento` |

Enquanto desligado dá para ver, card a card, quem passou sem provar — que é o
insumo para decidir quando apertar. Ligar hoje pararia todo trabalho em voo.

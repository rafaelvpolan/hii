# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## DECISÃO SUA — item 11 muda o custo do polimento, e isso é política

`despacharAgentesNaFase` existe, tem teste e **não está ligado**. Para ligar
falta uma coisa só: `config/pipeline.json` aceitando mais de um agente por passo
(`agents: []` em vez de `agent`). A mudança é contida — `motor/nmy/tipos.ts`,
`motor/nmy/config.ts` e o laço de `motor/qlb/ctr/fechar.ts`.

**Por que não fiz por dentro.** Hoje cada passo do polimento é uma chamada de
agente. Com dois especialistas num passo, o mesmo card passa a fazer duas — e o
pior caso do orçamento (`orcamentoPorCard.tetoUsd`, hoje US$ 16, calibrado em 8
chamadas) sobe junto. Quanto exatamente depende de quantos passos ganham
especialista, e isso é decisão de quanto você quer gastar por card, não de
engenharia.

**O que preciso:** ligar e recalibrar o teto, ou deixar declarado como
mecanismo pronto sem consumidor (como o item 18).

---

## DECISÃO SUA — de onde sai a referência externa do gauntlet (item 23)

O `CND` está completo e testado: comparação cega, boundary de orçamento, gatilho
por pack. **Não está ligado** porque falta a metade que não é código — de onde
vem a referência concreta e buscável contra a qual comparar.

Sem referência não há comparação cega, só opinião com nome novo. As opções que
vejo:

1. **Captura de tela de produto real**, anexada ao card como referência (o motor
   já sabe receber imagem: `motor/qlb/alf/anexo.ts`, usado pelo `implement`).
   É o caminho mais direto e reusa o que existe.
2. **Exemplo publicado** apontado por URL no card, buscado pelo `alf/refs.ts`
   com as guardas de rede que já existem.
3. **Biblioteca de referências por pack**, versionada em `skills/` — mais
   trabalho, mas reprodutível e auditável.

Minha recomendação é **(1)**, porque não inventa mecanismo novo: o card já pode
carregar imagem de referência, e o gauntlet passaria a comparar o resultado
contra ela. Diga qual e eu ligo.

---

## PRÓXIMA ONDA — medir instabilidade por alvo antes de automatizar teto

Sua decisão sobre reduzir `maxReajuste()`/`MAX_CONFLICT` para builds
cronicamente instáveis. Os dois tetos **já são** ajustáveis por env
(`HICODE_REAJUSTE_RETRIES`, `HICODE_CONFLICT_RETRIES`, default 2) — não falta
código para ser possível, falta saber **quais** alvos são instáveis.

**O pré-requisito agora existe.** O laço de conflito do `sync.ts` passou a emitir
`repair_attempt` e `gate_verdict` no diário, então os quatro pontos de reparo
finalmente contam. Falta a contagem por alvo e a exibição em `hii status`.

Continuo não recomendando detector automático: exigiria limiar, política de
decaimento e armazenamento, e ainda seria proxy para "isto está custando demais"
— que o `orcamentoPorCard` mede direto.

---

## Item 25 — dois efeitos externos ainda fora da chave

`executarComIdempotencia` tem **três** chamadores declarados em
`test/euc/idempotencia-contrato.test.ts`: `pr_create`, `matriz_criada` e
`aprendiz`. Continuam fora: `push` (`motor/qlb/git.ts:188-194`) e o laço de
conflito de `motor/qlb/ctr/sync.ts`.

O registro de chamadores está fazendo o trabalho — reprovou duas vezes até o
efeito novo ser declarado. Fechar os dois restantes é trabalho pequeno; o que
falta é decidir se `push` precisa (é idempotente por natureza com
`--force-with-lease`) ou se basta declarar a exceção com o motivo.

---

## PRECISO DE VOCÊ — `receipts/` sem rastreio

`receipts/receipts.jsonl` (32K, do plugin protect-mcp) está sem rastreio e fora
do `.gitignore`, e cresce a cada sessão. Não decidi por você porque as duas
leituras são plausíveis: log local descartável (vai pro `.gitignore`) ou trilha
de auditoria assinada que você quer versionada.

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

---

## ESTADO — mecanismo pronto sem consumidor, por decisão

Não são pendências: são escolhas registradas para não parecerem esquecimento.

**Item 18 (`executarEmBlocos`).** O laço de `motor/qlb/ctr/fechar.ts` já faz
executa → valida → para cedo. Rotear por TJL ali é cerimônia. O valor real —
fatiar uma implementação em blocos validados — exige fatiador determinístico por
stack, que pertence à camada de skill, não ao `core/`.

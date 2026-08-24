# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## ESTADO — as 13 ondas estão fechadas

Itens 1 a 34, incluindo os dois novos (33 MCN, 34 MIR). Não há próxima onda
planejada: o que vier daqui em diante entra como pendência nomeada abaixo ou
como onda nova em `WORKFLOW-EXECUCAO.md`.

---

## PENDÊNCIA — `truncVisible` percorre o texto inteiro para cortar 80 colunas

`larguraDeTexto`, `stripAnsi` e o `split` de `motor/mir/tui/layout.ts` varrem a
string toda antes do corte: medido ~189× mais caro num texto 500× maior.

**Não é travamento** — em absoluto são ~0,5ms para meio milhão de caracteres, e
`test/mir/tui-sob-carga.test.ts` guarda esse tempo. É ineficiência num caminho
quente: cada linha visível paga o custo da linha inteira, então log com linhas
gigantes encarece cada quadro.

Não corrigido de propósito. A função tem semântica delicada de grafema e ANSI, e
a saída óbvia — medir só um prefixo — parte cluster de grafema quando o corte cai
no meio de um. A margem segura existe, mas provar qual é ela merece atenção
própria, não um remendo no fim de uma onda de testes.

Onde mexer: `truncVisible` em `motor/mir/tui/layout.ts`. A rede está pronta —
`test/mir/largura.test.ts` fixa a tabela exata de cortes, grafemas, surrogates e
ANSI, então uma reescrita que passe ali preservou o comportamento.

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

---

## PENDÊNCIA — a suíte só prova o motor sob Bun

A suíte inteira roda sob `bun:test`, que não tem equivalente direto em Node. O CI
ganhou `node bin/hii.ts --help`, que prova que o grafo de import do CLI carrega sob
Node — o runtime da imagem de produção (`node:24-slim`). Não prova o resto.

Não é hipótese: foi exatamente essa cegueira que deixou a Onda 11 mergear verde com
uma imagem que morria em `ERR_MODULE_NOT_FOUND` no arranque, porque o Bun resolve
import relativo sem extensão e o Node não. `docker build` dava exit 0 e ninguém
tinha rodado o ENTRYPOINT. O invariante de `test/cdl/import-com-extensao.test.ts`
fecha ESSA falha; a assimetria de runtime que a produziu continua aberta.

Onde mexer: um passo de CI que exercite os caminhos de produção sob Node — subir o
daemon, bater no `/health`, fechar um card de ponta a ponta — ou migrar a suíte
para um runner que rode nos dois.

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

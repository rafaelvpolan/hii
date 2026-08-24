# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## PRÓXIMA ONDA — Onda 12, divergência antes de convergir (MCN, item 33)

Gerar alternativas e levar a divergência para decisão humana no `CLARIFY`, em vez
de convergir na primeira solução que aparece. Esboço em `WORKFLOW-EXECUCAO.md:742`.
Depois dela fica só a 13 (TUI). Os 32 itens originais estão fechados.

---

## PENDÊNCIA — a suíte só prova o motor sob Bun

Os 2134 testes rodam sob `bun:test`, que não tem equivalente direto em Node. O CI
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

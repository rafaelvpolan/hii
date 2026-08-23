# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## DECISÃO SUA — os 6 commits de `fix/auditoria-altas` estão viajando junto

**O que é.** A branch `feat/brazil-onda-0` foi criada a partir de
`fix/auditoria-altas`, não de `main`. Aquela branch tem 6 commits sem PR aberto,
e eles agora fazem parte deste trabalho.

**Por que foi assim.** Um rename de 172 arquivos partindo de `main` conflitaria
de forma irrecuperável com aqueles 6 commits — qualquer um dos dois que
mergeasse primeiro inviabilizaria o outro.

**O que decidir.** Ou (a) os 6 commits saem num PR próprio antes, e este
trabalho é rebaseado em cima; ou (b) tudo entra num PR só, assumindo um diff
grande. Não dá para decidir isso sem saber se aqueles commits já foram
revisados por alguém.

---

## DECISÃO SUA — nome de arquivo de teste não acompanhou o rename

**O que é.** A Onda 1 renomeou 172 arquivos de código e manteve os 158 arquivos
de teste com os nomes antigos: `test/finish-cost.test.ts` exercita
`motor/qlb/ctr/fechar.ts`, `test/kimi-adapter.test.ts` exercita
`motor/tmd/harness/kimi.ts`.

**O que já não é mais problema.** A detecção de "sem teste correspondente"
deixou de depender do nome (agora casa por import), então isso não gera mais
falso-negativo no auditor.

**O que sobra.** Só coerência de leitura: quem abre `test/` não vê a taxonomia
BRAZIL. Renomear são ~40 arquivos e um diff cego pelo repositório, com zero
ganho funcional.

**O que decidir.** Vale a onda de rename de testes, ou o custo não paga?
Recomendação: não pagar agora, e renomear cada teste quando ele for tocado por
outro motivo.

---

## FALTA EXECUTAR — teste de aceitação manual da Onda 3

**O que é.** `kill -9` no daemon durante um card em `EXECUTING`, durante `URL`,
e depois de `PR_OPEN`. Reiniciar. Nos três casos o card tem de retomar na fase
certa e **nenhum efeito externo pode duplicar**.

**Por que não foi feito aqui.** Os automatizados cobrem a lógica
(`test/pr-orfao.test.ts` reproduz a sequência exata do PR duplicado), mas
nenhum deles mata um processo de verdade nem fala com o GitHub. Precisa de um
repo-alvo real e de um `gh` autenticado.

**Onde está registrado.** `WORKFLOW-EXECUCAO.md`, Onda 3.

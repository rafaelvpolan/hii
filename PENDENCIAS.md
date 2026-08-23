# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## Custo por card no pior caso é ~2,5× maior do que o teto que a Onda 9 vai usar

**O que é.** O Celer mediu, na auditoria do Nexus: o pior caso de um card não é
o teto de `orcamentoPorCard` que o item 19 (Onda 9) pretende impor. São
**quatro** pontos de reparo independentes, cada um com teto próprio de 2:
`testGate`, `buildWithReajuste` pós-teste, `buildWithReajuste` pós-sync, e o
laço de conflito em `motor/qlb/ctr/sync.ts:41-64` (que não usa
`repararAteOTeto`). Somados: **8 chamadas de agente por card**, ≈ US$ 5,57 a
mais que o teto estimado — total ≈ **US$ 15,52–15,67/card** no pior caso, contra
US$ 9,95–10,10 estimados.

**Por que fica aqui.** É insumo para a Onda 9, não defeito a corrigir agora. Mas
se o teto for calibrado pelo número antigo, ele vai disparar antes do que se
espera — ou tarde demais, dependendo de qual regime foi usado. Os três regimes
são: observado US$ 1,55–1,96 · típico US$ 2,87 · teto US$ 15,52–15,67.

**Decisão que vai precisar.** Reduzir `maxReajuste()`/`MAX_CONFLICT` para builds
cronicamente instáveis, ou aceitar o teto alto e deixar `orcamentoPorCard`
cortar. É política, não engenharia.

---

## O laço de conflito de merge é a única cópia de reparo ainda fora do padrão

`motor/qlb/ctr/sync.ts:41-64` tem laço próprio com teto próprio (`MAX_CONFLICT`),
não usa `repararAteOTeto` e não escreve no diário. Depois desta auditoria é a
última: `subirUrlComAjuste` passou a registrar, e `runGatedStep` tem motivo real
para não migrar (intercala o gate do crivo entre execução e reparo, coisa que
`GateReparavel.rodar()` não modela).

Não migrei junto porque resolução de conflito de merge tem semântica própria
(mexe em arquivo em conflito, não em erro de build) e merecia um olhar que esta
rodada não deu.

---

Nada mais em aberto.

As três últimas saíram daqui resolvidas: o destino dos commits de
`fix/auditoria-altas` (decidido: trabalho linear, um PR único — aberto em
`rafaelvpolan/hii#5`), o rename dos arquivos de teste (feito na Onda 1b) e o
teste de aceitação da Onda 3 (executado contra `hicode-site` com `gh` real, e
achou o defeito do SIGTERM).

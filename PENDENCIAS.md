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

R: (b) Trabalho linear baseado em cima doque vai sendo feito, tudo vai ser revisado depois em UM PR unico, pode abrir o PR das branchs ja feitas para ser aprovado a atualizado na atual.
---

Nada em aberto.

# Regras do projeto para o motor hicode

Estas regras sao ADITIVAS ao CLAUDE.md do repositorio; nunca o substituem.
Escreva aqui, curto, o que o motor precisa saber deste projeto (stack, convencoes,
o que nunca mexer). Quanto mais curto, menos tokens por card.

## Branch de trabalho (regra do dono do projeto)

- Nunca trabalhe diretamente em `main`: nada de editar, commitar ou executar tarefa nela.
- Todo trabalho nasce numa branch propria (`feat/...`, `fix/...`, `hicode/<id>-<slug>`),
  criada a partir da `main` atualizada. Se a branch da tarefa ja existe, RETOME-A;
  so recomece da `main` quando o humano pedir "refazer do zero".
- A unica excecao e o humano pedir explicitamente para mexer em `main`.
- `main` so recebe codigo por PR mergeado pelo humano.

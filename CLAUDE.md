# hii — regras para quem trabalha neste repo com IA

## Branch de trabalho

- Nunca edite, commite ou execute trabalho diretamente em `main`.
- Antes de qualquer alteracao, parta da `main` atualizada e crie uma branch propria
  (`feat/...`, `fix/...`) — a skill `branch-from-main` faz exatamente isso. Se ja
  houver mudanca pendente em `main`, mova-a para a branch com `git switch -c` antes
  de continuar.
- A unica excecao e o usuario pedir explicitamente para trabalhar em `main`.
- `main` so recebe codigo por PR mergeado pelo humano.

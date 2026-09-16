# hii — regras para quem trabalha neste repo com IA

Leia [AGENTS.md](AGENTS.md) para arquitetura, invariantes, isolamento do motor
ativo e validação. As regras abaixo também se aplicam ao Claude. Procedimentos
locais estão em `.agents/skills/hii-*/SKILL.md`; quando um for solicitado, leia o
arquivo correspondente, sem presumir descoberta automática neste harness.

## Branch de trabalho

- Nunca edite, commite ou execute trabalho diretamente em `main`.
- Antes de qualquer alteracao, parta da `main` atualizada e crie uma branch propria
  (`feat/...`, `fix/...`) — a skill `branch-from-main` faz exatamente isso. Se ja
  houver mudanca pendente em `main`, mova-a para a branch com `git switch -c` antes
  de continuar.
- A unica excecao e o usuario pedir explicitamente para trabalhar em `main`.
- `main` so recebe codigo por PR mergeado pelo humano.

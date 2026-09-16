# Primeira melhoria do HII conduzida pelo HII

## Objetivo

Criar `docs/diagnostico-gateway-pipeline.md`, um guia curto para o operador
distinguir uma chamada gateway concluída de uma entrega orquestrada validada.
Adicionar um link para o guia na seção "Gateway e orquestração por pedido" do README.

## Escopo permitido

- Novo guia em `docs/diagnostico-gateway-pipeline.md`.
- Link e uma frase de apresentação na seção existente do `README.md`.
- Leia `AGENTS.md` e o código relevante; não altere `motor/`, `bin/`, testes,
  dependências, configuração de IA nem estado operacional.
- Trabalhe no worktree/branch que o motor já forneceu. Não inicie outro HII,
  outro pipeline ou launcher ECC, não faça merge e não atualize o daemon.

## Critérios de aceite

1. O guia explica, com referências ao código, que gateway chama o harness no
   checkout registrado e que seu COMPLETED não prova execução do pipeline de PR.
2. Mostra `/hii <tarefa ou arquivo.spec>` como entrada explícita na TUI e distingue
   seus comandos de comandos do terminal e de skills `$...` do Codex.
3. Explica como conferir evidência atual e por que timeout/ausência de verificação
   não devem ser apresentados como aprovação; não promete microtarefas paralelas.
4. O diff contém somente os dois arquivos permitidos, sem links quebrados.
5. `git diff --check` passa. Os testes existentes de contrato, execução, evidências
   e pedido orquestrado, listados em `docs/autoaperfeicoamento.md`, passam sob Node.

## Entrega e parada

Apresente os resultados das verificações e um PR revisável. Se não conseguir
validar, informe o bloqueio e preserve o trabalho. Não enfraqueça critérios para
concluir, não repita indefinidamente e não afirme ter executado checks omitidos.

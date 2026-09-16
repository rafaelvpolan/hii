---
name: hii-desenvolver
description: Implementar melhorias e corrigir defeitos no motor HII, preservando estado, contratos e isolamento do executor. Use para mudanças no próprio repositório HII, não para tarefas em aplicações-alvo.
---

# Desenvolver o HII

Leia `AGENTS.md` na raiz do checkout. Parta do pedido/issue e identifique o
caminho afetado: gateway, execução orquestrada, fila, adaptador, TUI ou API.

## Executar uma mudança delimitada

1. Confira branch, worktree e alterações existentes. Se já estiver no worktree
   criado pelo motor, reutilize-o; não abra um pipeline recursivo para esta tarefa.
2. Transforme o comportamento pedido em critérios observáveis. Para bug de
   runtime, reproduza-o com as fixtures em `test/`, sem tocar na fila ativa.
3. Implemente no ponto que já governa a operação. Preserve contratos e efeitos
   de retomada. Não enfraqueça gates, limites ou testes para obter aprovação.
4. Execute a validação proporcional descrita em `AGENTS.md`. Verifique a diferença
   entre sucesso do harness e evidência dos critérios da tarefa.
5. Entregue diff, resultados e limitações. Crie/atualize issue ou PR quando
   solicitado no trabalho; não faça merge nem reinicie o motor como efeito implícito.

## Quando a mudança envolve autoaperfeiçoamento

Consulte `docs/autoaperfeicoamento.md`: motor estável, alvo e candidato têm
responsabilidades distintas. O candidato não deve substituir o processo que o
está executando. Mudanças no próprio mecanismo de execução são preferencialmente
implementadas diretamente pela IA em worktree, com fixtures de validação.

Se ECC estiver disponível e fizer sentido para o pedido, aproveite orientações
de TDD/revisão dentro da etapa atual. Esta skill não exige ECC instalado, não
ativa workers tmux nem delega autoridade de fila, orçamento ou PR a outra camada.

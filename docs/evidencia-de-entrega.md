# Evidencia de entrega apos limpar o worktree

O fechamento passivo agora arquiva a prova antes da limpeza. O certificado inclui
execucao, sessao, projeto, hash/revisao do plano, relatorio dos criterios, commit
enviado, arvore Git e URL do PR. Seu SHA-256 fica no card; o arquivo e enderecado
pelo conteudo em cards/entregas. Tentativas diferentes nao sobrescrevem a historia.

So e emitido com worktree limpo (inclusive arquivos novos e submodulos), HEAD
igual ao push e fingerprint igual ao verificado. Criterios obrigatorios precisam
estar aprovados. Mudanca no card, relatorio ou trabalho impede certificacao.
A falha conserva o PR aberto e o worktree para inspecao. Parada humana concorrente
e preservada. Certificado e PR_OPEN sao vinculados sob o lock existente do card,
antes da limpeza; um crash posterior nao deixa a tarefa em estado executavel.

## Consulta

Avaliacao v1 ganhou o campo opcional entrega: head, tree, pr e merge.
O formato anterior permanece valido. Para execucoes entregues com certificado:

- O digest e todos os vinculos ao card/plano sao conferidos novamente.
- gh pr view precisa confirmar URL, head e estado do PR.
- Em PR_OPEN, o PR remoto precisa estar OPEN.
- Em MERGED/DEPLOYED, o PR precisa estar MERGED; gh api consulta o commit integrado.
  Sua arvore precisa ser identica a arvore validada, inclusive em squash/rebase.
- Cada leitura remota tem limite de cinco segundos, sem retry implicito.
- Alteracao concorrente do card/certificado invalida a consulta.

O resultado e uma observacao datada. Nao executa testes, nao faz fetch, checkout,
push ou merge. Erro remoto, credencial ausente, PR fechado, head alterado ou arvore
diferente conserva os resultados historicos e deixa os criterios inconclusivos.

O certificado continua verificavel sem worktree e sem o ponteiro mutavel de
evidencias. Ele nao e uma assinatura contra um administrador malicioso com
acesso ao estado do motor; o digest detecta corrupcao e troca acidental. Arquivos
de entrega sao preservados junto do estado operacional, sem expiracao automatica
neste incremento. Remover o certificado torna a avaliacao inconclusiva.

## Limites e reversao

Evidencia do commit original nao comprova alteracoes introduzidas pelo merge.
Quando a base avancou e a arvore integrada difere, e necessaria nova verificacao;
nao e promovida por semelhanca de diff. Nao certifica deploy ou resultado de
negocio. Execucoes antigas sem certificado continuam usando a regra anterior:
worktree ausente significa inconclusao. Nao ha backfill que invente prova.

O Hicode mostra os commits e a arvore, e pode concluir produto apenas quando os
vinculos e criterios ja exigidos tambem forem satisfeitos. Consultar progresso nao despacha tarefas. O despacho explicito pode
[comprovar dependencias de produto](dependencias-de-produto.md) antes de criar a execucao.

Rollback para o consumidor anterior ignora o campo opcional. Rollback do motor
mantem os arquivos, mas volta a exigir worktree; perde disponibilidade da prova,
sem presumir sucesso. Nenhuma migracao de cards e obrigatoria.

## Evidencia de validacao

Fixtures usam Git real, push em repositorio bare temporario, fechamento completo
e exclusao do worktree. O GitHub e simulado, sem PR remoto de fixture. Testes
cobrem retry, merge identico, head/arvore divergentes, corrupcao, rede ausente e
parada humana entre certificacao e fecho. O E2E Hicode usa HTTP real do HII,
prova arquivada e invalidacao do remoto em desktop e celular.

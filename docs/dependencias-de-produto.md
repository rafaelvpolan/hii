# Despacho com dependencias de produto

O documento tecnico continua declarando IDs de produto em dependencias. A API
anuncia tecnico.dependenciasProduto=1 e aceita, junto do documento, uma lista
opcional dependencias com produto, execucao e tecnicoHash. Sem essa capacidade,
o Hicode recusa despachar tarefas dependentes. Cards avulsos continuam iguais.

## Comprovacao antes de criar

Ha no maximo oito dependencias diretas. O motor exige correspondencia exata,
sem repeticoes ou auto-referencia, com a lista do documento. Cada predecessora
precisa ser do mesmo projeto, planejamento e revisao de origem, ter o hash
tecnico indicado, modo passivo, status MERGED/DEPLOYED e criterios aprovados
com certificado de entrega atual e merge remoto conferido.

PR aberto, COMPLETED de gateway, entrega divergente, revisao antiga e ausencia
de certificado bloqueiam antes da criacao de card. O Hicode tambem exige
cobertura dos criterios de produto e a revisao tecnica aprovada atual.
O planejamento Hicode continua rejeitando ciclos de produto; o motor valida
estritamente os grafos de microtasks e exige predecessoras ja entregues.

A preparacao consulta o remoto sem manter lock de arquivo atraves de await.
Depois, sob a trava de idempotencia existente, os ETags sao conferidos antes
de registrar intencao e executar a criacao sincrona. Recusas de pre-condicao
nao fixam erro na chave. Pedidos confirmados retornam a resposta registrada
sem reconsultar dependencias, inclusive apos perda de resposta. Resultado
incerto de um efeito ja iniciado continua exigindo reconciliacao.

## Intencao e base

O Hicode fixa os vinculos de dependencia na intencao de envio, antes de criar
a sessao. Retry de intencao pendente usa esses mesmos vinculos; nunca troca o
conteudo silenciosamente sob a mesma chave. Para adotar outra revisao tecnica
predecessora depois desse ponto, revise e aprove uma nova revisao da sucessora.
Intencoes antigas sem vinculos nao recebem prova inventada.

O plano HII persiste dependenciasProduto com produto, execucao, hash tecnico,
digest do certificado e commit de merge observado. Antes de chamar qualquer IA,
executarPlano exige que cada merge seja ancestral de HEAD do worktree.
O fluxo normal ja faz fetch da base ao preparar worktree. Branch retomada
desatualizada ou base que nao contenha a entrega bloqueia sem chamada de IA;
o trabalho existente e preservado para reconciliacao.

Ancestralidade comprova integracao historica, nao que uma mudanca posterior
nao tenha revertido comportamento. Os gates da sucessora continuam obrigatorios.
A prova e uma observacao do momento do envio; nao e lock sobre o GitHub.

## Operacao e limites

Nao cria fila alternativa nem despacha sucessoras automaticamente. O usuario
continua aprovando e solicitando despacho de cada card. Execucao de microtasks
permanece serial; este incremento nao implementa paralelismo.

Rollback para motor anterior volta a recusar dependencias. Rollback do painel
nao muda execucoes existentes; seus planos e provas continuam persistidos.
Nao ha migracao obrigatoria nem alteracao da instalacao ativa.

Validacao usa API HTTP e Git reais, remoto GitHub controlado, concorrencia,
perda de resposta, revisao divergente e base sem commit predecessor. O E2E
Hicode cobre bloqueio, entrega, despacho e retry em desktop e celular, sem IA paga.

# Documento tecnico recebido pelo motor

POST /v1/sessoes/{id}/pedidos aceita {modo:"orquestrador",tecnico:"<JSON integral>"}.
O handshake anuncia tecnico.versoes=[1] e limiteLinhas=500. O contrato puro fica em
motor/oswaldo/orquestracao/tecnico.ts; o Hicode usa uma copia verificada desse arquivo.

A fonte inclui identidade e revisao do planejamento, tarefa de produto, contexto,
solucao, escopo, exclusoes, referencias, riscos, criterios com resultados esperados,
microtarefas com IA/modelo opcional, DAG e instrucoes operacionais. O limite
conta linhas fisicas do JSON (metadados e vazias incluidos), normalizando CRLF.
Uma quebra final e ignorada; 501 linhas sao recusadas, nunca truncadas. Ha tambem
limite de 200000 bytes UTF-8.

Antes de criar card, o motor valida escopo, DAG, provedores e verificadores.
Os comandos vem do contrato local do projeto, nunca de shell no documento.
Dependencias de produto sem reconciliacao verificavel bloqueiam o despacho.
Criterios obrigatorios sem comando suportado tambem bloqueiam.

A criacao usa INBOX: ainda fora da fila. O plano e salvo, a revisao/hash sao fixados
no card e o pedido e vinculado a sessao antes da aprovacao existente liberar
EXECUTING. Se a escrita for interrompida, INBOX aparece no radar para reconciliacao;
nao ha consumo automatico nem reexecucao silenciosa de intencao incerta.
A API conserva a fonte integral e hash em origemTecnica e liga produtoId, sessao
e execucao. O estado enfileirada/mensagem explica recusas dos gates existentes.

O executor permanece serial e usa a atribuicao de IA ja suportada por microtarefa.
Ter um plano aceito nao comprova criterios nem conclusao. Evidencias e gates
continuam responsaveis pelo resultado; texto de E2E/logging/observabilidade
preservado na fonte nao e tratado como evidencia executada.

Validacao: fixtures HTTP Bun/Node para 500/501, CRLF, JSON malformado, escopo,
dependencias, ausencia de contrato e idempotencia; navegador Hicode desktop/mobile
com perda de resposta depois do despacho. Nenhum daemon ativo ou IA real usados.

Escopo parcial de #47/#46 e hicode#21. Este incremento nao fecha automaticamente
essas issues nem implementa paralelismo, setup completo ou novas familias de gates.

# Estado e partida do motor pela API

GET /v1/motor/status exige o bearer da API e não modifica tarefas. A API roda separada do daemon e pode informar estado desligado mesmo permanecendo acessível.

A resposta usa protocolo 1, estado (ligado, desligado, degradado ou desconhecido), versao (instalada), versaoEmExecucao (processo confirmado ou null), fila (SHA-256 do caminho canônico, sem expor o caminho), consultadoEm e motivo. Ligado exige lock de processo vivo e presença recente publicada pelo próprio daemon, com a mesma fila da API. Presença vencida, fila divergente e instalação antiga sem presença não são tratadas como disponibilidade. O daemon publica a presença a cada dois segundos; a confirmação vence após dez segundos. A API não afirma desligado por falta de resposta de rede: essa condição pertence ao cliente e deve aparecer como indisponível.

POST /v1/motor/iniciar aceita somente o objeto JSON vazio. Exige API administrativa, sem escopo restrito por projeto, e HII_API_AUTOSTART=1. A configuração e a fila pertencem ao ambiente da API; o cliente não pode escolher argumentos, executável ou diretório. A operação reutiliza scripts/runner-daemon.sh start, serializa a partida por lock, limita o comando a dez segundos e aguarda até cinco segundos pela presença pronta. Uma tentativa que não inicia tem intervalo mínimo de sessenta segundos antes da próxima. Não há reinício forçado nem laço automático de relançamento. A partida do daemon pode consumir tarefas já elegíveis na fila configurada; não transforma cards pausados em elegíveis.

Para admitir um card legado READY, POST /v1/tarefas/{id}/acoes aceita acao iniciar, If-Match e Idempotency-Key. A própria API verifica o estado do motor e faz a transição para EXECUTING. EXECUTING continua sendo o estado elegível ao executor; não comprova que uma IA já começou a chamada. Cards pausados exigem a ação explícita de retomada. A consulta de estado não admite trabalho.

Após atualizar uma instalação antiga, o operador precisa atualizar o processo do daemon para publicar presença. Um git pull não altera o código do processo já em memória. O Hicode mostra a versão em execução quando disponível e a instalada quando o daemon está desligado.

Validação isolada: test/api/estado-motor.test.ts, test/api/iniciar-motor.test.ts e test/api/http.test.ts. Nenhum desses testes inicia o daemon operacional nem executa IA.

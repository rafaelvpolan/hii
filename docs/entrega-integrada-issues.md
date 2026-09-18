# Entrega integrada: issues HII e Hicode

Branch candidata comum: codex/entrega-integrada-issues. Bases: HII 6248cb1 e
Hicode 35269fa. Instalacoes ativas, cards e processos do operador nao sao usados
como fixtures. Um PR por repositorio; nenhum merge automatico.

## Estado da auditoria

Esta matriz registra trabalho em andamento, nao declara todas as issues resolvidas.

| Issue | Incremento nesta branch | Pendencia para conclusao integral |
| --- | --- | --- |
| HII #46 | Consolidacao das provas dos fluxos abaixo | Auditar todo o epico; escopo editorial de hicode-site separado |
| HII #47 | Leitura CRLF; IDs ambiguos recusados; recuperacao versionada | Completar matriz de round-trip/compatibilidade |
| HII #48 | Diagnostico de recuperacao; MCP desconectado nao vira conectado nem falta de OAuth | Setup idempotente, rollback e diagnostico MCP completo |
| HII #49 | Criterios reais antes de liberar sucessoras; checkpoint alterado bloqueia replay | Paralelismo isolado, integracao e politica de redistribuicao |
| HII #50 | Provas por microtask separadas da evidencia final; regressao de falso sucesso | Auditar matriz completa TUI/rollout |
| HII #51 | Parecer estruturado por especialista, API, reserva/cache, deduplicacao e sintese no PR | Rubricas por dominio, cache do Crivo principal, publicacao pendente e limites completos |
| HII #59 | Captura duravel de preferencias antes do despacho; testes adversariais | Politica/localidade, Ollama agentivo, sete trilhas e piloto |
| Hicode #19/#20 | Base existente preservada | Revalidar descoberta e hierarquia ponta a ponta |
| Hicode #24 | Nenhuma entrega nova ainda | Politica e acompanhamento local pelo contrato HII |
| Hicode #31 | Heartbeat entre Bun/Node usa uptime do SO e identidade do processo | Revalidar suite de status/autostart |
| Hicode #32 | Recuperacao usa tema legivel, responsivo | Revalidar contraste e telas restantes |
| Hicode #34 | API/preview/importacao pausada, snapshots, vinculo persistente, retomada explicita e E2E | Reconciliar dependencias entre produtos e sessoes nativas; lacunas bloqueiam em vez de inventar estado |

## Provas ja executadas

- Regressao RED: agente falso declara sucesso com exit=7 ou criterio sem comando;
  ambos liberavam sucessoras na base anterior. GREEN apos exigir verificacao real.
- Executor: 10 testes passaram, incluindo dependencia, cota, parada humana, efeito
  interrompido e alteracao externa sem replay.
- Recuperacao HII: 6 testes HTTP passaram; painel: 3 testes e 38 assercoes passaram.
- E2E real Hicode/API em processos separados: filas distintas, IDs 020 duplicados,
  tarefa 025, preservacao byte a byte, worktree com arquivo novo, reload e 390px.
  A presenca do daemon e simulada e nenhuma IA e chamada nesse teste.
- Heartbeat: 9 testes passaram, incluindo processo Node consultado pelo Bun.
  Medicao mostrou que process.hrtime tem origens distintas nesses runtimes;
  uptime do SO e a referencia compartilhada.
- Suite Bun do HII no primeiro checkpoint: 330 arquivos, 3282 testes, zero falhas.
- Suite do Hicode: 30 arquivos, 206 testes, um skip existente, zero falhas.
- Primeira suite Node: 3246 passaram e um teste de prazo WAITING falhou.
  Isolado passou. O teste agora injeta o instante do tick, sem ampliar tolerancia
  ou remover assert. Nova execucao integral passou: 3250 testes gerais e 30
  testes sensiveis isolados, zero falhas. O contrato OpenAPI exportado tambem
  foi sincronizado apos a suite detectar sua versao antiga.

Resultados acima sao checkpoints. Os PRs finais devem conter a validacao do HEAD,
com quaisquer falhas e limites ainda presentes. Nao usar esta tabela para fechar
automaticamente as issues.

## Recuperacao v1

POST /v1/recuperacoes/previa e passivo; POST /v1/recuperacoes/importar usa hash da
previa e Idempotency-Key. O pacote preserva documento e artefatos (ate 1 MiB/64
itens), autenticacao e escopo de projeto. Nada e truncado silenciosamente.

GET /v1/tarefas/{id}/recuperacao confere origem, worktree registrado, branch e
fingerprint. Preparar exige If-Match e fingerprint vistos pelo operador.
Restaurar configuracao exige hash de snapshot e revisao da tarefa. Nenhuma dessas
operacoes despacha IA. Retomar e uma acao separada e exige daemon confirmado.

Plano legado v1 com historico e checkpoint completos pode ser migrado. Entrega
externa, dependencia de produto ainda nao reconciliada, efeito incerto ou worktree
perdido permanece bloqueado. O arquivo original e mantido. A instalacao real do #025
somente podera ser recuperada apos diagnostico dessa instalacao; passar na fixture
nao equivale a ter migrado o card operacional.

Rollback: retirar a UI/rotas novas conserva os arquivos originais e os arquivos
de recuperacao; nao apagar arquivos pendentes nem liberar automaticamente as
copias locais. Desabilitar um recurso nao autoriza reexecutar efeitos incertos.


## Checkpoint de revisao especializada

Politica opcional em gate.revisao de config/ia.json e POST /v1/configuracao.
O Crivo original continua obrigatorio. Os especialistas acrescentam pareceres
estruturados e nao substituem os testes nem representam, por si, IAs independentes.
A politica deve conter pelo menos um revisor ativo obrigatorio. Papel ausente,
cobertura parcial, JSON invalido e parada humana bloqueiam esse revisor.

Relatorios por fingerprint/base/rubrica/politica sao imutaveis. A reserva precede
a chamada; intencao sem resposta exige reconciliacao e nao autoriza nova inferencia
automatica. Uma revisao explicita da politica permite outra rodada. Sao no maximo
oito revisores, cada um com timeout de 60 segundos; nao ha loop de correcao.
O teto governado e consultado antes de cada chamada; custo desconhecido interrompe
as chamadas seguintes. Isso nao e garantia de teto financeiro dentro de um
subprocesso cujo provedor nao oferece limite de gasto.

Nove testes de revisao passaram em Bun; os sete primeiros tambem em Node e os
nove integrados passaram em Node junto dos testes do gate (17 no total).
A suite Bun completa encontrou o registro de consumidores do teto desatualizado:
3294 pass, uma falha. O novo consumidor foi acrescentado ao invariante; a suite
precisa ser repetida no HEAD final. MCP: dois casos RED reproduziram falsos
diagnosticos; apos correcao, 17 testes passaram.

A CI dos commits publicados inicialmente passou nos dois PRs. Isso nao valida
automaticamente os incrementos ainda nao publicados.

## Diagnostico estruturado

hii doctor --json e GET /v1/diagnostico fornecem envelope v1 com checks identificados,
escopo, estado, severidade, correcao, horario e duracao. A API exige administrador
sem restricao de projetos; executa a sonda em subprocesso, com timeout global
de 30 segundos e no maximo uma sonda simultanea por processo da API.
Ausencia de catalogo de modelos e modelo nao listado sao avisos diferentes:
nenhum deles comprova acesso remoto nem substitui validacao antes do despacho.

A configuracao mostra os mesmos resolvedores usados pelo motor e avisa quando
uma preferencia de modo antiga foi normalizada. A origem do modelo padrao e
declarada como adaptador (env ou padrao), sem inventar uma origem mais precisa.
Setup/aplicacao/reversao e MCP completo por tarefa ainda precisam ser concluidos.

Validacao deste incremento: 73 testes Node de API, revisao, doctor, MCP e
orcamento passaram; tipos e lint:types tambem passaram.

## Validacao do segundo checkpoint

- HII Bun: 332 arquivos, 3305 testes aprovados, zero falhas.
- HII Node: suite geral e 30 testes sensiveis isolados aprovados, zero falhas.
- typecheck, lint:types e lint:clone aprovados.
- O apendice gerado de OPERACAO.md foi sincronizado depois de os testes de
  documentacao detectarem deriva. Nenhuma assercao foi removida para aprovar.
- Revisao especializada: 12 cenarios, incluindo resposta atrasada, custo,
  concorrencia, parada humana e novo commit. Provedores sao fixtures.
- Hicode: 208 testes aprovados, um skip existente, tipos e build aprovados.
  Dois casos RED/GREEN adicionais cobrem vinculo truncado e identidade invalida.
  Erro de um vinculo nao derruba os demais cards; consultas limitadas a quatro
  em voo com prazo total de cinco segundos.


## Migracao validada de plano legado v1

O pacote inclui planos/<projeto>-<id>.json e orquestracao/execucao-<id>-<revisao>.json.
O motor confere identidade, hash, revisoes, dependencias concluidas, tentativas,
custo conhecido e fingerprint do worktree. IDs da nova execucao sao registrados
sem alterar o arquivo original; historico e custos anteriores permanecem arquivados.
Preparar nao despacha IA. A retomada verifica novamente criterios das microtasks
concluidas e executa apenas as pendentes.

Intencao de migracao tem chaves deterministicas por revisao. Repetir o preparo
reconcilia gravacoes parciais; checkpoint de destino alterado nao e sobrescrito.
Tentativa executando/interrompida, ausencia de artefato ou custo divergente bloqueia.
Dependencias entre produtos ainda exigem reconciliacao de IDs/certificados.
Nenhuma sessao nativa de provedor e anunciada como migrada por este fluxo.

A prova de importacao rege o primeiro despacho. Depois da adocao, a tarefa usa
os checkpoints atuais; o fingerprint original nao bloqueia a etapa seguinte
por causa de alteracoes que o proprio motor fez.

Provas: cinco testes de migracao passaram sob Node junto dos seis testes HTTP;
suite Bun com 333 arquivos/3310 testes aprovada; suite Node geral e 30 testes
sensiveis aprovados. E2E Hicode/API com plano e checkpoint legados passou em
desktop/390px e reload. O daemon e simulado, sem inferencia; a unidade do executor
usa worktree Git real e mostra somente B executada, com A preservada.

Apos a suite completa, a auto-revisao acrescentou um caso de arquivo de origem
truncado (RED/GREEN) e reutilizou o executor de grupos de processos no doctor.
Seis testes de migracao passaram em Bun/Node e quatro testes do doctor em Node,
com typecheck aprovado; esses dois ajustes finais nao sao apresentados como uma
nova execucao integral da suite.

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
| HII #48 | Diagnostico de recuperacao distingue motor, tarefa e worktree | Setup idempotente, rollback e diagnostico MCP completo |
| HII #49 | Criterios reais antes de liberar sucessoras; checkpoint alterado bloqueia replay | Paralelismo isolado, integracao e politica de redistribuicao |
| HII #50 | Provas por microtask separadas da evidencia final; regressao de falso sucesso | Auditar matriz completa TUI/rollout |
| HII #51 | Nenhuma entrega nova ainda | Revisoes especializadas, deduplicacao e sintese idempotente |
| HII #59 | Captura duravel de preferencias antes do despacho; testes adversariais | Politica/localidade, Ollama agentivo, sete trilhas e piloto |
| Hicode #19/#20 | Base existente preservada | Revalidar descoberta e hierarquia ponta a ponta |
| Hicode #24 | Nenhuma entrega nova ainda | Politica e acompanhamento local pelo contrato HII |
| Hicode #31 | Heartbeat entre Bun/Node usa uptime do SO e identidade do processo | Revalidar suite de status/autostart |
| Hicode #32 | Recuperacao usa tema legivel, responsivo | Revalidar contraste e telas restantes |
| Hicode #34 | API/preview/importacao pausada, snapshots, vinculo persistente, retomada explicita e E2E | Migrar checkpoint/plano legado completo; lacunas bloqueiam em vez de inventar estado |

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

Origem com plano legado ainda nao migrado, entrega externa ou worktree perdido
permanece bloqueada. O arquivo original e mantido. A instalacao real do #025
somente podera ser recuperada apos diagnostico dessa instalacao; passar na fixture
nao equivale a ter migrado o card operacional.

Rollback: retirar a UI/rotas novas conserva os arquivos originais e os arquivos
de recuperacao; nao apagar arquivos pendentes nem liberar automaticamente as
copias locais. Desabilitar um recurso nao autoriza reexecutar efeitos incertos.

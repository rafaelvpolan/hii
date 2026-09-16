# Diagnostico Hicode / HII

## Resultado

**Integracao parcial. O Hicode atual nao e um cliente completo do HII deste PR.**
Compartilhar diretorios permite ler tarefas, mas nao garante os mesmos comandos,
sessions, estados, eventos ou regras de execucao. A issue #47 continua aberta.

Revisoes verificadas em 15/09/2026:

- HII: `463feeeb22f47ea5b64f1ce56d3a9db1c7f4c1ca`, PR #52.
- Hicode: `21dae62ca1f98d1975c093ad8e83505f64591732`, `origin/main` atualizada.
- O checkout original do Hicode estava em `feat/motor-stack-aware-ui`; nao foi
  alterado. O diagnostico usou um worktree separado da main remota.

## Prova entre os repositorios

`scripts/diagnosticar-hicode.mjs` importa os modulos reais dos dois projetos,
cria fixtures em uma pasta temporaria e chama somente `--status` e `estado --json`
pelo cliente CLI. Nao inicia daemon, nao executa agentes, nao modifica projetos
alvo e remove as fixtures ao terminar. Use somente um checkout confiavel: os
modulos importados sao codigo executavel, nao dados de uma API.

```bash
bun scripts/diagnosticar-hicode.mjs /caminho/do/hicode
```

Resultado: **13 verificacoes, 4 compativeis, 9 lacunas, zero chamadas de IA**.
Exit code `1` sinaliza lacunas; nao significa que houve uma execucao paga com falha.
O JSON inclui os SHAs lidos e a observacao de cada verificacao. Este diagnostico
nao substitui um teste de navegador nem uma execucao produtiva ponta a ponta.

| Verificacao | Resultado observado |
| --- | --- |
| Cliente com binario `hii` no PATH | `--status` termina com exit code 1, sem timeout |
| Cliente com `estado --json` | Rejeitado antes de iniciar processo |
| Armazenamento local compartilhado | Tarefa escrita pelo Hicode e lida pelo HII |
| Pedido novo pelo painel | Sem `sessao_id`/`motor_modo`; HII classifica como legado |
| Estado `COMPLETED` | Desconhecido; nenhum evento `fim` |
| Estado `CONFIRM` | Desconhecido; nenhum evento `pausa` |
| Estado `PR_OPEN` | Evento de fim recebido |
| Veredito Codefox | `APPROVED` sintetico recebido como evento |
| Troca Claude para Codex | Gravada pelo HII no log bruto; nenhum evento estruturado |
| Historico de conversas | Snapshot HII possui uma conversa; estado do painel nao a expoe |
| Vinculo da execucao | `sessao_id` descartado pelo estado do painel |
| Variaveis `HICODE_*` | Herdadas pelo HII quando `HII_*` correspondente nao existe |
| Transporte remoto | Somente `processo-local`; HTTP/SSE do motor nao implementado |

A ultima linha e uma limitacao de implantacao, nao uma falha do transporte local.
O sucesso do veredito prova a leitura de um resultado, nao a invocacao do Codefox.

## Achados prioritarios

### 1. Conclusao e confirmacao desaparecem no consumidor

O vocabulario do Hicode nao inclui `COMPLETED` nem `CONFIRM`.
`statusCanonicoOuNulo` retorna `null`; leitores de fim, pausa e mudanca de status
descartam esses estados. `paraCardStatus` ainda converte desconhecidos em `INBOX`.
Isso pode deixar uma tela sem notificacao de termino ou sem pedido de confirmacao.
Nao foi afirmado que toda tela fica em `INBOX`: `getState` preserva o status bruto.

Fontes Hicode: [status.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/shared/status.ts),
[eventos.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/motor/eventos.ts),
[quadro.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/motor/quadro.ts).

### 2. Criacao e acoes nao passam pela autoridade do HII

O painel cria e altera Markdown diretamente. `submit` nao registra session,
mensagem nem modo de execucao. `start`, `resume` e `resolve` gravam `EXECUTING`
sem passar pelas guardas atuais do HII. Ha risco de retomar a etapa errada ou
contornar a espera por um harness ainda em encerramento. Essa parte foi inspecionada
no codigo; nao foi reproduzida com um harness pago em voo.

Fontes Hicode: [acoes.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/card/acoes.ts),
[acoes HTTP](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/api/cards/%5Bid%5D/%5Baction%5D.post.ts).
Contraparte HII: `motor/mirante/acoes.ts`, `motor/mirante/execucao-da-sessao.ts`.

### 3. O cliente CLI ainda fala o protocolo antigo

`dispatch` permite `--init`, `--sync`, `--status`, `--once`. O binario atual aceita
os verbos sem `--`. O fallback `bun runner.ts` ainda usa flags antigas, portanto
o comportamento depende de qual entrypoint foi encontrado. `estado --json`,
`tarefa` e `pipeline` sao recusados pela allowlist do consumidor.
As rotas atuais do painel nem usam `dispatch` para suas mutacoes: escrevem em disco.
Corrigir somente a allowlist nao conecta as acoes da interface.

Tambem falta no HII uma porta de maquina equivalente a `/hii tarefa|file.spec`,
com selecao da session. O comando atual esta na TUI; `hii tarefa nova` cria um
pedido gateway, e `pipeline` administra planos/suite, sem equivalencia completa.
Essa lacuna pertence aos dois repositorios, nao apenas ao Hicode.

Fontes: [cli.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/motor/cli.ts),
`bin/hii.ts`, `motor/mirante/comandos-de-tarefa.ts`, `motor/mirante/despacho.ts`.

### 4. Sessions, orquestracao e capacidades nao chegam ao painel

`getState` retorna apenas `repos`, `cards`, `statuses` e projeta campos individuais,
descartando `tipo`, `sessao_id`, `motor_modo` e metadados do plano. Nao consome o
snapshot HII com `conversas` e subsessoes. A leitura de configuracao de IA existe,
mas nao e um catalogo unificado de skills/agentes/comandos Nexus, ECC e Codefox.
Mostrar um veredito Codefox ou nomes de agentes do pipeline nao permite invoca-los
como capacidades do motor. Faltam descoberta, selecao e despacho pelo mesmo contrato.

Fontes Hicode: [state.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/utils/state.ts),
[ia.get.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/api/ia.get.ts).
Produtor HII: `motor/mirante/estado-json.ts`, `motor/euclides/sessoes.ts`.

### 5. Eventos e transporte ainda sao locais e parciais

O Hicode expoe SSE para o navegador, mas a origem e polling de arquivos locais.
Nao ha transporte remoto selecionavel para o motor. O parser de logs reconhece
algumas ferramentas, custos e timeout, mas ignora as linhas de falha/troca de IA.
O endpoint de log bruto continua podendo mostrar essas linhas.
`sondarMotor` verifica existencia de entrypoint/home, nao negocia versao/capacidades:
um indicador de motor instalado nao prova compatibilidade funcional.

Fontes Hicode: [transporte.ts](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/motor/transporte.ts),
[sonda](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/servicos/motor.ts),
[log bruto](https://github.com/rafaelvpolan/hicode/blob/21dae62/panel/server/api/cards/%5Bid%5D/ai-log.get.ts).

## Testes existentes e limite da cobertura

No Hicode, rodados separadamente: `motor-cli` (10), `motor-eventos` (19),
`painel-status` (10 + 1 ignorado), `motor-cliente` (5): **44 passaram, 1 ignorado**.
Ao ativar `HICODE_CONTRATO_HII=1` com `HII_HOME` correto, `painel-status` teve
**10 passaram e 1 falhou**. O teste procura `lib/runner/queue-state.ts`, caminho
que nao existe mais no HII. Assim, a cobertura local verde nao valida esta integracao.

Nao foram feitos testes visuais do Hicode, deploy remoto, nem execucao produtiva
Claude/Codex/Kimi neste diagnostico. A suite ampla do HII foi validada anteriormente
no PR, mas nao substitui as provas entre produtor e consumidor acima.

## Ordem de correcao recomendada

1. Unificar estados/eventos e testar Hicode contra fixtures produzidas pelo HII.
2. Expor no HII o pedido orquestrado por texto/spec, com session, idempotencia e
   resultado JSON; reutilizar a mesma operacao na TUI e no cliente Hicode.
3. Migrar criacao, resposta, pausa, parada e retomada do painel para a porta do HII;
   remover as escritas paralelas que duplicam regras de negocio.
4. Consumir snapshot versionado com sessions, execucoes, subsessoes, planos e
   evidencias; expor catalogo de capacidades realmente invocaveis.
5. Publicar eventos estruturados de falha, troca, conclusao e confirmacao,
   correlacionados por session/execucao/subsessao, com retomada apos reconexao.
6. Negociar versao/capacidades no health check. Para uso remoto, adicionar transporte
   autenticado; no uso local, exigir os mesmos caminhos de estado/configuracao.

Aceite minimo: dois pedidos na mesma session, troca de provedor sem perder contexto,
log da falha e troca no painel, termino correto, confirmacao humana e retomada sem
duplicar trabalho. Provar primeiro com harnesses falsos e navegador real, sem custo
de IA. Este documento registra o diagnostico; nao declara essas correcoes entregues.

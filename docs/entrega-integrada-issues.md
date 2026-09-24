# Entrega integrada: issues HII e Hicode

Branch candidata comum: codex/entrega-integrada-issues. Bases: HII 6248cb1 e
Hicode 35269fa. Instalacoes ativas, cards e processos do operador nao sao usados
como fixtures. Um PR por repositorio; nenhum merge automatico.

## Estado da auditoria

Esta matriz registra trabalho em andamento, nao declara todas as issues resolvidas.

| Issue | Incremento nesta branch | Pendencia para conclusao integral |
| --- | --- | --- |
| HII #46 | Consolidacao das provas dos fluxos abaixo | Auditar todo o epico no escopo decidido: somente HII e Hicode |
| HII #47 | Leitura CRLF; IDs ambiguos recusados; recuperacao versionada | Completar matriz de round-trip/compatibilidade |
| HII #48 | Diagnostico estruturado; setup com previa/hash, migracao automatica `.hicode` -> `.hii`, aplicacao seletiva, retomada e reversao conservadora | MCP e diagnosticado apenas quando uma tarefa exige um conector aplicavel ao harness escolhido |
| HII #49 | Paralelismo isolado, integracao serial, prova combinada e redistribuicao segura por ramo | Limpeza governada dos worktrees preservados e piloto real |
| HII #50 | Provas por microtask separadas da evidencia final; regressao de falso sucesso | Auditar matriz completa TUI/rollout |
| HII #51 | Parecer estruturado por especialista, rubricas v2 por dominio, API, reserva/cache, deduplicacao, sintese no PR e escolha persistida entre revisao humana e auto review | Cache do Crivo principal, publicacao reconciliavel e limites completos |
| HII #59 | Captura duravel de preferencias; roteamento por capacidade/tier; Ollama agentivo opt-in com eventos semanticos; plug remoto após falha local recuperável, inclusive por tentativa paralela | Piloto real e calibracao dos modelos por instalacao |
| Hicode #19/#20 | Base existente preservada | Revalidar descoberta e hierarquia ponta a ponta |
| Hicode #24 | API expoe localidade/fallback efetivos; painel permite escolher revisao humana ou automatica | Piloto real e calibracao por instalacao |
| Hicode #31 | Heartbeat entre Bun/Node usa uptime do SO e identidade do processo | Revalidar suite de status/autostart |
| Hicode #32 | Recuperacao usa tema legivel, responsivo | Revalidar contraste e telas restantes |
| Hicode #34 | API/preview/importacao pausada, snapshots, vinculo persistente, escolha humana de configuracao, retomada explicita e E2E | Reconciliar dependencias entre produtos e sessoes nativas; lacunas bloqueiam em vez de inventar estado |

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
Se a configuracao original nao puder ser comprovada, o diagnostico bloqueia a
preparacao. O snapshot da configuracao atual aparece somente como alternativa;
o operador precisa escolhe-lo explicitamente antes de liberar a retomada.

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

`gate.autoReview` registra a escolha do operador em `config/ia.json`: ausente
significa que a interface ainda deve perguntar, `false` escolhe revisao humana e
`true` ativa os revisores especializados. Ativar sem politica valida e recusado.
Mesmo no modo automatico, o Crivo principal continua obrigatorio e o motor nao
faz merge; no modo humano o PR segue sem chamadas extras aos especialistas.

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

MCP nao e requisito global do motor. O conector `omc`, pertencente ao ecossistema
Claude, nao e sondado pelo doctor como requisito do Codex. Quando uma tarefa pede
uma acao externa, o despacho continua verificando o conector aplicavel e distingue
ausencia, autenticacao, escopo dinamico e falha transitoria antes de chamar a IA.

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

## Checkpoint: microtasks paralelas opt-in

O executor agora admite uma onda de 2 a 4 microtasks com arquivos declarados,
distintos e sem infraestrutura compartilhada reconhecida. O padrão permanece 1.
Ativação: `hii pipeline microtasks 2 --repo owner/repo`. Reversão: o mesmo
comando com `1`; ramos já iniciados são reconciliados antes de novos despachos.

Cada ramo recebe worktree Git próprio, base fixada, tentativa, reserva de slots
da fila existente e parcela do orçamento disponível. A integração é serial e
registra intenção antes do merge. Um reinício reconhece o merge pelos dois pais,
sem invocar novamente a IA. Estado incerto, worktree alterado, conflito e alteração
fora dos arquivos declarados bloqueiam e preservam os artefatos. Critérios são
executados no ramo e novamente no trabalho combinado; a sucessora só é liberada
depois da segunda prova. O executor passou a bloquear novas chamadas quando uma
tentativa retorna custo desconhecido ou inválido, inclusive após retomada.

Evidência selecionada: teste RED do DAG anterior (C não começava enquanto B
aguardava) e GREEN com barreira de sincronização, Git real e executores falsos.
Onze cenários de paralelismo cobrem DAG, sobreposição, limite, crash de merge,
parada, escopo, prova combinada, custo e redistribuição. A autoria B/C também foi verificada no
snapshot público de observabilidade com harness falso.

Limites deste incremento: isolamento Git não equivale a sandbox de segurança;
não houve chamada paga ou benchmark de IA. A reserva financeira é admissão e
contabilização; provedores sem teto nativo podem ultrapassar o valor durante uma
chamada, caso em que a integração e os próximos despachos são bloqueados. Cota ou
falha local recuperável redistribui o ramo somente quando não há IA atribuída,
o custo anterior é conhecido, o orçamento comporta outra chamada e o worktree
continua limpo. Cada tentativa fica no checkpoint. Qualquer efeito no worktree
torna o resultado incerto e exige reconciliação, sem nova chamada. A migração
entre instalações recusa checkpoints com ramos paralelos até reconciliar seus
worktrees. Worktrees filhos são preservados para inspeção; limpeza automática
ainda não foi habilitada. Isso não encerra #49 nem #59.

Validação deste ajuste: 11 testes de paralelismo e typecheck aprovados; lint de
tipos e clone limpo aprovados na suíte integral. A suíte local parou no guardrail
de runtime porque a máquina está com Bun 1.2.21 e o repositório fixa Bun 1.4.0;
o CI do PR executa com a versão fixada.

Validação integral deste incremento: Bun 1.4.0, 334 arquivos/3322 testes;
Node 24, 3286 testes gerais + 30 sensíveis; zero falhas. Tipos, lint de tipos e
clone limpo aprovados. A primeira execução integral detectou CommonJS na fixture
nova; os comandos foram convertidos para ESM e a mesma suíte repetida sem
enfraquecer as asserções.

Tres rodadas de TUI E2E e visualizador 1365/390px aprovadas antes do ajuste final de log serial. Esse ajuste recebeu regressao RED/GREEN com CLI falso nos dois runtimes e nova execucao integral Bun/Node. O log serial do card foi preservado; apenas ramos paralelos ganham arquivos separados.

## Checkpoint: setup recuperavel e Ollama agentivo minimo

`hii pipeline setup` agora apenas apresenta um plano associado a hash. `apply`
aplica todos ou os IDs selecionados, registrando intenção e resultado por passo;
repetir o mesmo hash reconcilia interrupções. `undo` remove somente efeitos cujo
conteúdo e identidade ainda correspondem ao recibo e preserva qualquer alteração
posterior. O scaffold não instala ferramentas nem muda preferências de IA.

Quando existe somente `.hicode/`, o plano inclui primeiro uma migração automática
para `.hii/`. O rename é precedido por intenção durável e confirmado pela identidade
do diretório; uma interrupção após o efeito é reconciliada sem repetir a operação.
`undo` devolve a árvore ao nome legado apenas quando origem e destino ainda batem
com o recibo. A coexistência das duas árvores, origem que não seja diretório,
symlink e alterações concorrentes bloqueiam para escolha humana, sem sobrescrita.

O loop agentivo do Ollama é opt-in por `HII_OLLAMA_AGENTIC=1`. Antes da conversa,
`/api/show` precisa declarar `tools`. O motor oferece apenas leitura e substituição
exata em arquivo existente, recusa shell geral, path absoluto/Windows, traversal,
symlink e escrita em `readonly`, limita arquivo a 512 KiB e limita turnos,
chamadas e repetição. A resposta textual não substitui os gates posteriores.
Somente loopback tem custo de API local medido; rede privada fica desconhecida.
Isso não comprova onde a inferência ocorre. Em `somente_local`, o Ollama só fica
elegível após o operador verificar o deployment e definir
`HII_OLLAMA_LOCALITY_VERIFIED=1`; a API expõe a localidade como verificada,
indeterminada ou remota.

O harness publica fatos normalizados de modelo verificado, inferência iniciada e
concluída e ferramenta iniciada e concluída. A projeção guarda apenas o tipo e o
nome da ferramenta, sem prompt, argumentos ou resultado. Chamadas múltiplas da
mesma resposta são executadas em série antes da inferência seguinte. A cobertura
integrada passou com 19 testes de Ollama/API, além de typecheck, lint de tipos e
clone limpo.

As provas usam servidor/CLI falsos e diretórios temporários; não houve inferência
real, download de modelo ou afirmação de sandbox de SO. O piloto Ollama continua
pendente; a política `somente_local` é coberta no checkpoint de localidade abaixo.

Validação da migração: 10 cenários em Bun 1.4.0 e Node, incluindo crash após
rename, aplicação parcial, reversão conservadora e conflitos. No HEAD deste
checkpoint passaram typecheck, lint de tipos, clone limpo, Bun com 336 arquivos e
3335 testes e Node com 3299 testes gerais mais 30 sensíveis, sem falhas.

## Checkpoint: plug remoto e localidade

O roteador existente continua escolhendo por papel, capacidade, autenticação, cota,
custo, tokens e tier da tarefa. Agora uma falha transiente de um executor local
também pode acionar um provedor remoto apto, sem recriar a tarefa nem trocar o
worktree. A tentativa anterior, o destino e o motivo ficam registrados no card e
no live log; um provedor já tentado não volta na mesma rodada.

`HII_REMOTE_FALLBACK=off` desliga esse plug. `HII_EXECUTION_LOCALITY=somente_local`
é uma restrição mais forte: candidatos remotos ou de localidade indeterminada
são excluídos e a tarefa segue a
política de espera/parada local. `preferir_local` é o padrão e `qualquer` permite
o ranqueamento normal. Falha terminal nunca troca de provedor. A política por tier
em `config/model-tier.json` continua escolhendo o modelo adequado ao tipo da ação
dentro do provedor configurado, sem inventar nomes de modelos ou contrariar uma
escolha explícita do operador.

GET /v1/configuracao informa a localidade resolvida e se o fallback remoto esta
efetivamente ligado. Esse campo e somente leitura: a politica operacional continua
sob controle do motor. O Hicode pode exibi-la sem deduzir localidade pelo nome do
provedor e pode persistir gate.autoReview pela mesma API administrativa.

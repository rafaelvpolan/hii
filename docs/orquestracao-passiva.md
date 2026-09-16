# Orquestracao por pedido do HII

## Escopo desta entrega

Base atualizada: `main` em `52209646254d185d8f13f2b9f65d61c6a5c33e2c`.
Branch: `feat/orquestrador-passivo`. Relacionada a #46, #47, #48, #49, #50 e #51.
As issues abrangem mais que esta implementacao e nao devem ser fechadas automaticamente.

O comando reaproveitado e `/hii`. Nao foi criado outro comando de orquestrador.
O motor e gateway por padrao. `/hii <tarefa ou arquivo.spec>` aciona o orquestrador
somente para esse pedido, dentro da session atual. Nao ha interruptor on/off nem
ativacao persistente. Configuracoes antigas de modo passivo nao alteram novos pedidos comuns.
Cada execucao captura o modo na criacao; o valor interno `passivo` foi preservado
para compatibilidade dos registros, mas nao representa mais ativacao por projeto.
Uma tarefa antiga sem esse campo continua no pipeline legado.

## Comandos

| TUI | Efeito |
| --- | --- |
| `/hii implemente a API` | Cria uma execucao orquestrada na session atual |
| `/hii tarefas/login.spec` | Le o arquivo relativo ao projeto selecionado e cria a execucao |
| `/hii "docs/meu plano.spec"` | Aceita caminho com espacos; arquivo absoluto tambem e aceito |
| `/new [assunto]` | Cria session HII no projeto selecionado |
| `/ask <pergunta>` | Consulta em modo readonly, sem criar execucao de tarefa |

No CLI, use `hii pipeline status|doctor|setup --repo owner/repo` para manutencao.
Importacao: `hii pipeline plan <id> <arquivo.json> --repo owner/repo`.
Pipeline manual: `hii pipeline <id>` ou ENTER na tarefa pausada.
Fechamento: `hii pipeline close <session> --repo owner/repo`, com saida `#id closed`.
O setup nao instala pacotes, autentica provedores ou provisiona MCPs automaticamente.

O `.spec` (tambem `.spec.md`) e texto UTF-8, distinto do contrato JSON v1. Seu conteudo
e capturado na criacao da execucao; alteracoes futuras no arquivo nao mudam esse pedido.
Arquivo ausente, diretorio, conteudo vazio/binario, UTF-8 invalido ou mais de 1 MiB
sao recusados antes de criar a tarefa. Titulos Markdown internos sao protegidos
para nao serem confundidos com secoes de controle do card. Mencionar um spec numa
descricao, como `/hii implemente conforme o contrato file.spec`, continua sendo texto.

## Session e contexto

Uma session tem ID proprio e recebe varias execucoes. Cada chamada de IA registra
provedor, modelo, papel, inicio, fim e estado em uma subsession. O ID nativo do provedor
permanece nulo quando nao foi obtido: isto nao equivale a retomar a thread nativa do CLI.

Mensagens ficam em `cards/sessoes/<id>.json`. O contexto enviado inclui mensagens recentes
com autoria e identificacao da execucao, limitado a 24.000 caracteres. Quando o limite
e atingido, o prompt aponta o historico completo em disco. Nao ha resumo semantico
automatico nem garantia de incluir todas as mensagens na janela de um modelo.

Pedidos de uma session sao encadeados na fila. Um predecessor pendente bloqueia os
seguintes. Gateways de sessions distintas do mesmo projeto tambem sao serializados,
pois escrevem no mesmo clone. Execucoes passivas usam seus worktrees e obedecem ao teto
por projeto (padrao 1) e ao teto global ja existente.
O reinicio aguarda harnesses ainda vivos antes de redistribuir trabalho, inclusive
para outra session gateway do mesmo projeto. Subsessoes sem processo sao marcadas
como interrompidas na reconciliacao.

## Gateway

1. O pedido captura `motor_modo: gateway` e `sessao_id`.
2. O daemon verifica projeto e orcamento e chama o harness no diretorio do projeto.
3. O harness aplica suas restricoes de modo; o gateway nao injeta pipeline/Nexus.
4. Falha de cota consulta o roteador existente e escreve causa e troca no live log.
5. Outro provedor elegivel continua a mesma execucao, com contexto e arquivos preservados.
6. Sem rota, vale a politica existente de espera/parada. Trocas sao limitadas e nao ciclam.
7. Sucesso termina em COMPLETED, que nao e recuperado como trabalho pendente no boot.

O HII nao cria worktree, commit ou PR neste caminho. O proprio harness pode executar
acoes autorizadas pelo pedido e por suas configuracoes. `/ask` exige isolamento readonly.
Parada humana nao pode ser sobrescrita pelo retorno tardio de uma chamada.

## Plano e DAG

O contrato v1 distingue plano, session, execucao e microtask. Exige objetivo, risco,
criterios, dependencias e campos de rollout. Rejeita ciclos, IDs duplicados, referencias
ausentes, caminhos absolutos/traversal e documentos acima de 500 linhas, inclusive CRLF.
Nao trunca documentos. Revisoes usam escrita atomica, trava, revisao esperada e chave
idempotente; o hash e conferido ao reler o historico.

O plano inicial e deterministico: uma microtask de implementacao e comandos encontrados
no contrato local. Se nao houver verificacao executavel, o criterio fica inconclusivo.
Planos importados podem ter varias microtasks e dependencias. O executor percorre ondas
validas, mas executa as microtasks **serialmente no mesmo worktree**. Um checkpoint
registra tarefas concluidas; a retomada nao repaga as ja concluidas quando o trabalho
permanece com o fingerprint registrado. Alteracoes externas invalidam esse cache,
sem apagar o diff. O orcamento e conferido entre microtasks.

Os agentes de implementacao aceitos sao os do catalogo existente. Provedores sem
subagentes nativos recebem a adaptacao de papeis ja existente no HII.

## Evidencias e PR

Depois dos gates e da integracao de base existentes, cada criterio executavel roda
um processo real. O relatorio registra comando, exit code, sinal, timeout, duracao e
saida redigida. O fingerprint cobre HEAD, diff binario e arquivos novos nao ignorados.
Symlink de diretorio que sai do worktree e recusado. Mudanca durante a verificacao
invalida o resultado. Criterio obrigatorio inconclusivo/reprovado impede o PR.
Uma parada humana durante essa coleta impede a chamada seguinte ao Codefox.

O Codefox existente revisa o resultado. Antes do push, o fingerprint e conferido outra
vez. No modo passivo, o publicador consulta PRs da branch/base no remoto: adota um PR
aberto apos crash, atualiza apenas o bloco entre `<!-- hii:inicio -->` e `<!-- hii:fim -->`
e preserva texto humano externo. Falha da consulta nao significa lista vazia. PRs
encerrados ou ambiguos exigem decisao humana. Nao ha merge automatico.

Custo nao reportado continua marcado como desconhecido/piso. Registros no mesmo
segundo ganham sufixo, evitando que uma tentativa sobrescreva outra no historico.

## Persistencia e integracao

| Caminho relativo a cards/ | Conteudo |
| --- | --- |
| `sessoes/<id>.json` | Conversa, execucoes e subsessoes |
| `orquestracao/<hash-do-projeto>.json` | Configuracao por projeto |
| `orquestracao/execucao-<id>-<revisao>.json` | Checkpoint do DAG |
| `planos/<hash-do-projeto>-<id>.json` | Historico de revisoes do plano |
| `evidencias/<id>-<revisao>.json` | Ultimo relatorio da revisao |
| `runs/<id>.live.log` | Saida em tempo real e mensagens de roteamento |

`hii estado --json --repo owner/repo` adiciona `conversas` e `orquestrador` ao snapshot.
O contrato de snapshot permanece v1 por ser aditivo. Os leitores legados de `sessoes`
e dos arquivos Markdown continuam disponiveis. Conversas contem dados do projeto;
nao publique snapshots sem revisao. A redacao de segredos e aplicada a evidencias,
nao representa uma garantia de anonimizar todo o historico.

## Validacao

Testes novos usam harnesses falsos e comandos locais. Cobrem contrato, conflito de
revisao, contexto entre provedores, troca por cota, cancelamento, fila, retomada de DAG,
fingerprint, timeout, exit code, redacao de segredo e reconciliacao de PR.

O teste de TUI envia teclas ao createApp real e reconstrui os frames ANSI com telaVirtual,
em 48 e 100 colunas. Nao se limita a procurar strings no codigo. As suites amplas
rodam em Bun e Node; a preferencia pessoal de IA fica isolada por processo de teste.

O visualizador local esta em `docs/processo-orquestracao.html`. Ele mostra o fluxo,
os contratos, os gates e o escopo entregue/pendente, e aceita snapshots JSON locais.
`node scripts/validar-visualizador.mjs` verifica abas, diagrama/canvas, importacao,
tratamento de JSON invalido e texto malicioso em desktop e celular. Um argumento
opcional define a pasta das capturas; o padrao e `/tmp/hii-visualizador`.

## Continuacoes das issues

A integracao com a main atual do Hicode foi [diagnosticada separadamente](conexao-hicode/diagnostico-inicial.md).
O snapshot aditivo nao significa que o painel ja o consome; o diagnostico reproduz
as incompatibilidades de comandos, estados, sessions e eventos sem chamar IA.
O motor agora oferece [HTTP/JSON + SSE autenticado](conexao-hicode/README.md), OpenAPI,
cliente de referencia e testes reais de comunicacao. A migracao do Hicode segue pendente.

| Issue | Entregue aqui | Ainda pendente |
| --- | --- | --- |
| #46 | Acionamento por tarefa/spec e caminho executavel no motor | Fluxo de descoberta/produto no Hicode e publicacao editorial |
| #47 | Contrato v1, revisoes, DAG, snapshot e API HTTP/JSON + SSE | Migracao do adapter Hicode, editor e validacao visual ponta a ponta |
| #48 | Setup local idempotente; doctor confere auth/capacidades | Provisionamento selecionavel de MCPs e diagnostico WSL completo |
| #49 | DAG serial, checkpoints, contexto, retomada sem apagar diff | Planejador semantico e worktrees paralelos por microtask |
| #50 | Evidencias executaveis, fingerprint, bloqueio e TUI testada | Politicas executaveis completas de observabilidade/rollout e retencao de todos os relatorios |
| #51 | Reuso do Codefox e PR reconciliado com corpo humano preservado | Consolidacao/dedupe de findings de varios revisores e resolucao de divergencias |

Kimi nao foi alterado. Nenhum avaliador pago adicional foi introduzido para validar esta entrega.

# Observabilidade externa v1

Extensão de `/v1/capacidades`, independente dos enums legados de `/v1/eventos`.
HII continua dono da fila, orçamento, aprovação, fallback, sessão e retomada.
Um cliente observador só usa GET. Reconectar nunca cria trabalho.

## Contrato e reconciliação

`GET /v1/observabilidade/snapshot?repo=org/app&sessao=077&execucao=078`
retorna `versao`, `cursor`, `atividades`, `degradado`, `motivo`, `proxima` e
`retencao`. Filtros são opcionais para a credencial de operador. `limite` é
1–100; `depois=proxima` pagina por ID. Estado e cursor de cada página vêm da
mesma leitura atômica. Assine a partir do cursor da PRIMEIRA página; aplicar
revisões posteriores elimina duplicatas/alterações ocorridas durante a paginação.

`GET /v1/observabilidade/eventos`, com os mesmos filtros e `Last-Event-ID`,
emite `activity`, `output`, `cursor` e `reset`. Cada evento contém a revisão da
atividade. Um evento de saída carrega somente seu último fragmento; a projeção
mescla por sequência. Não existe garantia exactly-once. Cursor expirado retorna
409; consulte todas as páginas novamente. O cliente de referência faz isso
também a cada 30 segundos, reconecta após erro e oferece `dispose()`.

Atividade: ID único por tentativa, pai, recurso, repo, sessão, execução,
subsessão, microtask, revisão do plano, revisão monotônica, estado, etapa,
início/fim, último progresso, heartbeat e métricas. Estados: `queued`,
`running`, `waiting_human`, `waiting_retry`, `blocked`, `succeeded`, `failed`,
`cancelled`, `skipped`, `unknown`. Terminais são imutáveis; retomada cria
outra tentativa correlacionada. O processo é identificado por PID e início
no kernel. Processo ausente torna uma chamada não terminal `unknown`, não
inventa sucesso/falha; o estado autoritativo do card continua consultável.

Recurso: namespace/nome/tipo/origem/versão/capacidades/observabilidade.
`GET /v1/observabilidade/recursos?repo=org/app` descobre harnesses, agentes,
skills do acervo e comandos efetivamente encontrados. Recursos disponíveis
não são atividades. Skills carregadas são conteúdo com hash e evidência de
inclusão no prompt, nunca processos. Papéis injetados não comprovam workers.
Origens ECC/Nexus só aparecem quando descobertas, sem equivalência inventada.

Saída: `stdout`, `stderr`, `assistant`, `error`; sequência por atividade,
instante, texto redigido e sinal de truncamento. Os adaptadores Codex e Claude
stream publicam mensagens estruturadas públicas antes do fim. JSON bruto,
argv, prompt e raciocínio interno não são exportados. Demais adaptadores
declaram cobertura parcial e publicam o resultado final. Kimi não foi alterado.
Ferramentas internas não confirmadas pelo adaptador são não observáveis.
Heartbeat não conta como progresso; não há porcentagem estimada.

Valores de custo e tokens trazem fonte, instante e qualidade; desconhecido é
`null`, nunca zero. A ausência de modelo informado significa que o padrão do
CLI não foi confirmado. Loop expõe iteração, limite e motivo de saída; crivo
expõe ativação/elegibilidade/recusa do gauntlet e o veredito real.

## Persistência e limites

`cards/observabilidade/estado.json` é uma transação atômica de projeção e
eventos, sob lock compartilhado entre processos; SSE lê apenas após commit.
É separado do journal de efeitos `runs/*.eventos.jsonl`. Nunca participa da
decisão de repetir trabalho pago. Falha de escrita é isolada e sinalizada como
degradação no processo observador. Arquivo ilegível retorna snapshot degradado.
Não apague o journal de efeitos para recuperar telemetria.

Retenção: 2.048 eventos, 512 atividades e sete dias para terminais, com saída
limitada a 16 Ki caracteres/64 registros por atividade (8 Ki por fragmento).
Snapshots sobrevivem à expiração dos eventos enquanto dentro da retenção de
atividades. Cursor muda de geração se o registro for removido. Não há promessa
de histórico infinito. Máximo de 16 streams; cliente lento é desconectado no
primeiro backpressure e reconstrói por cursor/snapshot.

Orçamento de overhead definido antes da medição: p95 de commit menor que
100 ms em fixture local com 2.100 transições, saída de 128 caracteres, sem IA;
arquivo menor que 16 MiB. Esse orçamento não mede latência de provedores.

## Comandos tipados

- `POST /v1/ask {repo, pergunta}` → 202 e ID; `GET /v1/consultas/{id}`.
  Sem card executável. Exige isolamento readonly do harness. Até quatro
  consultas simultâneas. Crash não repete a chamada: resultado pode ser unknown.
- `GET/POST /v1/configuracao`: POST exige `versao:1`, papel, opções tipadas,
  `If-Match` e `Idempotency-Key`. Só com `HII_API_ADMIN=1`. Snapshot de
  preferências é capturado no despacho, preservando chamadas em andamento.
- `POST /v1/tarefas/{id}/plano {plano,revisaoEsperada}`: exige revisão da
  tarefa e idempotência, tarefa parada e nenhum harness em voo. DAG validado;
  comandos executáveis novos exigem contrato local. Revisão salva não ativa
  automaticamente execução nem aprovação. GET informa plano e evidências.
- `GET /v1/tarefas/{id}/artefatos` e `/v1/artefatos/{id}`: IDs opacos, conteúdo
  textual limitado, tipo, tamanho, SHA-256 e expiração; evidências são
  registradas pelo motor. Não aceita caminho de arquivo. Symlinks recusados.
- `GET /v1/tarefas/{id}/perguntas` retorna ID, opções, origem e ETag da
  pergunta; `POST /v1/tarefas/{id}/respostas {perguntaId,texto}` exige essa
  revisão. Uma resposta atrasada não é aplicada à próxima pergunta, mesmo que
  o status do card não tenha mudado. Ações legadas continuam compatíveis.
- `GET /v1/tarefas/{id}/historico?offset=0` pagina o journal autoritativo em
  lotes de 200, independente da janela SSE. Nunca o reexecuta.

## Autorização e dados

Bearer pertence ao backend, nunca ao navegador. `Origin` é recusado no motor.
Sem configuração extra, a credencial representa um operador da instalação,
não uma solução multiusuário. `HII_API_REPOS=org/app,org/outro` restringe essa
instância da API: filtros obrigatórios nas listas, validação do projeto de
cada recurso e recusa das rotas globais não escopadas. Filtrar não concede
acesso. Use instâncias/credenciais distintas para escopos diferentes.
O Hicode autentica sua sessão de navegador e usa o token somente no backend.
TLS e distribuição de credenciais pertencem à implantação.

Valores de segredos conhecidos por variáveis de ambiente e padrões de
credenciais são redigidos. Nenhum redator pode identificar todo segredo
arbitrário que o operador decidir incluir em texto; não envie credenciais como
objetivo. A saída pública não contém o manifesto integral de contexto/prompt.

## Inventário de paridade

| Superfície TUI/CLI | Contrato externo / evento | Permissão e verificação |
| --- | --- | --- |
| Projetos, seleção `/repo` | GET projetos, filtro repo | operador; HTTP auth/scope |
| `/new`, mensagens e encadeamento | sessões + pedidos | POST idempotente; HTTP concorrência/restart |
| Texto, `/hii`, spec | pedidos gateway/orquestrador | explícito; HTTP modos/spec |
| Fila, preflight, deps, espera | estado/card + atividades | leitura; transições reais |
| Plano/DAG/microtasks | GET/POST plano | revisão+pausa; validação de contrato |
| Aprovar/recusar/responder | ações v1 | If-Match + guardas existentes |
| Parar/retomar/fecho | ações e sessão/fechar | idempotência; harness em voo |
| Harness/role/skill/loops/crivo | observabilidade v1 | readonly; replay/terminal/falhas |
| Saída incremental | SSE output + log v1 | canais, sequência, limite/redação |
| `/ask` | ask + consultas + atividades | readonly; fixture sem card |
| `/ia /model /effort /mode /gauntlet` | configuração v1 | admin, ETag, snapshot por despacho |
| Fallback/erro/checkpoint | atividades + estado/plano | mesma execução, tentativas distintas |
| Evidências, resultado e PR | plano, artefatos, tarefa/session | revisão/fingerprint; custo unknown distinto |
| Histórico/reconexão | snapshot paginado + SSE | cursor expirado, rebuild/dispose |
| `/login` | disponibilidade de provedores | login continua local/interativo; não há transporte de credenciais |
| `/ref`, clipboard, binários de imagem | não exposto nesta extensão | exige protocolo de upload separado; nenhum fallback de filesystem no conector |
| `/serve`, daemon start/stop/restart, `/rm`, manutenção de disco | não exposto | administra host/processos e destrói recursos; continua CLI local, sem shell remoto |
| Atalhos manuais de pipeline | ações existentes/retomar | passos novos só após verbo tipado com as mesmas guardas; sem terminal remoto |
| Teclas, layout, autocomplete, sair da TUI | UI local | não são operações do motor |

Itens locais acima são limitações explícitas de superfície, não autorização
para o Hicode ler ou escrever cards. Webhooks/OTel e métricas internas dos
modelos não fazem parte deste contrato.

## Ativação, teste e reversão

Comece com fixtures e depois uma instância separada do candidato. `hii api`
expõe o contrato; não inicia daemon. Ative a credencial de operador e configure
o backend Hicode conforme seu README. O exemplo
`examples/observador.ts` usa somente o cliente público; nenhum scheduler.
Para reverter só a instrumentação: `HII_OBSERVABILIDADE=0` no próximo processo.
Cards, sessões, journal de efeitos, orçamento e ações v1 permanecem autoritativos.
Nunca reinicie o motor ativo apenas para validar o candidato.

Integração visual coordenada: [Hicode #22](https://github.com/rafaelvpolan/hicode/issues/22),
entregue no [PR #23](https://github.com/rafaelvpolan/hicode/pull/23).

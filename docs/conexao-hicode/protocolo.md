# Protocolo Hicode / HII

[Indice da conexao](README.md)

## Decisao

**HTTP com JSON para comandos/consultas e SSE para eventos, com contrato OpenAPI
3.1.1 versionado em `/v1`.** O HII e o unico escritor do estado. O backend Nuxt do
Hicode autentica usuarios do painel e se comunica com o motor; o navegador nunca
recebe a credencial do HII nem escreve em seus arquivos.

| Alternativa | Avaliacao para estes projetos |
| --- | --- |
| CLI + arquivos compartilhados | Mantido para uso local/compatibilidade, mas acopla deploy, formatos e regras. Foi a origem das divergencias diagnosticadas |
| HTTP/JSON + SSE | Escolhido: comandos pontuais por HTTP, eventos do motor para o painel, reconexao com cursor e proxies convencionais |
| WebSocket | Possivel no futuro para terminal interativo bidirecional; nao necessario para despachar pedidos e acompanhar o estado |
| MCP | Adequado a ferramentas/contexto consumidos por agentes; nao substitui o contrato de sessions, controle humano e estado do painel |
| gRPC | Tipagem forte, mas adiciona geracao/transporte sem necessidade demonstrada neste backend web |

Esta escolha e uma decisao de arquitetura para Hicode/HII, nao uma afirmacao de que
SSE e sempre melhor. Referencias primarias consultadas:
[SSE / Last-Event-ID](https://html.spec.whatwg.org/multipage/server-sent-events.html),
[OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html),
[transportes MCP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Subir o motor HTTP

Configure `HII_API_TOKEN` com um segredo aleatorio de pelo menos 32 caracteres sem
espacos no ambiente **do servidor**, por secret manager ou arquivo protegido fora
do git. Nao use chave de provedor de IA como token desta API.

```bash
hii api
```

Padroes: `HII_API_HOST=127.0.0.1`, `HII_API_PORT=8787`. Token e obrigatorio inclusive
no loopback. Configuracao de estado (`HII_CARDS_DIR`, `HII_REPOS_FILE` etc.) deve ser
a mesma do daemon. `hii api` nao inicia uma IA nem sobe o daemon implicitamente;
`hii start` continua sendo o comando que inicia o executor da fila.

O endpoint padrao e `http://127.0.0.1:8787`. Um teste local nao significa que esta
porta permaneceu aberta apos a validacao. Porta ocupada causa erro, nao encerra o
processo que ja a utiliza. SIGINT/SIGTERM encerram HTTP e streams.

Para acesso entre hosts, use TLS num reverse proxy, restricao de rede e o token no
backend Hicode. So configure bind externo deliberadamente. A API e single-user:
o token concede acesso aos projetos registrados no motor, sem ACL por projeto.
Nao exponha diretamente na internet nem embuta o token em URL, HTML ou localStorage.
Requests com `Origin` sao recusados; nao ha CORS para acesso direto do navegador.

## Contrato e cliente

Contrato executavel: `motor/api/openapi.ts`; servido em `GET /v1/openapi.json` e
exportado para [openapi.json](openapi.json):

```bash
bun scripts/exportar-api.mjs
```

Cliente TypeScript de referencia: `motor/api/cliente.ts`. Ele usa `fetch`, nao
le arquivos do motor e nao segue redirects com a credencial. Os imports dos tipos
sao removidos em runtime. O Hicode pode integrar esse modulo pelo workspace ou
gerar seu proprio cliente a partir do OpenAPI; este PR nao altera seu build.

Antes de habilitar controles no painel, consultar `/v1/capacidades` e exigir
`protocolo: hii-http` e `versao: 1`. Estados e acoes devem vir do contrato, incluindo
`COMPLETED` e `CONFIRM`; desconhecidos nao devem virar `INBOX` silenciosamente.

| Endpoint | Funcao |
| --- | --- |
| `GET /v1/capacidades` | Protocolo, versao, estados, acoes, eventos e limites |
| `GET /v1/estado?repo=owner/repo` | Snapshot do motor, conversas/subsessoes e cursor de eventos |
| `GET /v1/projetos` | Projetos ja registrados no motor |
| `GET /v1/provedores` | Disponibilidade, modelos conhecidos e papeis; nao seleciona provedor nem chama IA |
| `GET /v1/recursos?repo=owner/repo` | Catalogo de comandos/skills descobertos para o provedor ativo e projeto; nao executa recurso |
| `GET /v1/sessoes[?repo=...]` | Sessions persistidas |
| `POST /v1/sessoes` | Nova session com `{repo,titulo}` |
| `GET /v1/sessoes/{id}` | Historico, execucoes, subsessoes e ETag |
| `POST /v1/sessoes/{id}/pedidos` | Pedido gateway ou orquestrado por texto/conteudo de spec |
| `POST /v1/sessoes/{id}/fechar` | Fecha quando nao ha execucoes pendentes/em voo; body `{}` |
| `GET /v1/tarefas/{id}` | Campos, corpo e ETag da execucao |
| `POST /v1/tarefas/{id}/acoes` | Acao humana validada pelo motor |
| `GET /v1/tarefas/{id}/plano` | Plano e ultimo relatorio da revisao, se existentes; nao revalida fingerprint nem executa criterio |
| `GET /v1/tarefas/{id}/log?offset=0` | Ate 64 KiB de log, cursor em bytes e indicador de truncamento |
| `GET /v1/eventos` | SSE de estado, session, falha e troca de IA |

Identificadores sao strings numericas de 3 a 12 digitos. Nao remova o padding.
Specs na API sao enviados como conteudo, nao como caminhos do servidor. Limite
de 1 MiB de texto UTF-8; corpo HTTP de no maximo 2 MiB. O Hicode le o arquivo
selecionado pelo usuario e envia `{nome,conteudo}`. Isso evita transformar o motor
em um leitor arbitrario do filesystem remoto.

Exemplo de integracao server-side com o cliente de referencia:

```ts
const motor = clienteHii(urlDoMotor, tokenDoServidor)
const { valor: capacidades } = await motor.capacidades()
if (capacidades.protocolo !== 'hii-http' || capacidades.versao !== 1) throw new Error('motor incompativel')
const { valor: sessao } = await motor.novaSessao('owner/repo', 'Login', chaveDaSession)
const { valor: execucao } = await motor.pedido(sessao.id, {
  modo: 'orquestrador',
  spec: { nome: 'login.spec', conteudo: textoDoArquivo },
}, chaveDoPedido)
```

`chaveDaSession` e `chaveDoPedido` sao geradas uma vez por intencao e preservadas
para retentativas. Nao gerar outra chave automaticamente quando a resposta cair.
Pedidos comuns seguintes usam `modo: gateway`: nao ha on/off persistente.
O modo interno persistido `passivo` continua sendo o nome legado para orquestracao.
Um `201` com `enfileirada: false` indica tarefa criada mas bloqueada por uma guarda;
o painel deve apresentar `mensagem` e o estado, nao mostrar que esta executando.

## Idempotencia e concorrencia

Toda mutacao exige `Idempotency-Key` (8-128 caracteres `A-Z a-z 0-9 . _ : -`).
Mesma chave, rota, corpo e If-Match retornam a resposta persistida, inclusive apos
reinicio. Reuso da chave com outro pedido retorna `409 chave_reutilizada`.

Um registro pendente e gravado antes do efeito. Se houver crash antes de salvar
a resposta, a retentativa retorna `409 resultado_incerto`, sem executar de novo.
Consulte o estado para reconciliar antes de criar outra intencao. Nao se promete
transacao distribuida/exactly-once entre todos os arquivos. Os registros ficam em
`cards/ponte/pedidos`; nao os apague enquanto clientes puderem repetir essas chaves.

Acoes em tarefas e fechamento exigem `If-Match` obtido no GET daquele recurso.
Ausencia retorna `428`; revisao antiga retorna `412`. A revisao e conferida tambem
sob o lock da primeira escrita. As guardas de estado/harness do motor continuam
valendo; a API nao aceita alteracao arbitraria de status nem comandos shell.

Acoes: `aprovar-plano`, `aprovar-url`, `recusar`, `responder`, `parar`, `retomar`,
`confirmar-fecho`, `recusar-fecho`. `texto` e opcional, salvo quando a regra da acao
exige motivo/resposta. Parar registra parada humana e solicita encerramento do
harness. Retomar respeita checkpoint e espera o harness anterior encerrar.
Nao ha merge, delete, login interativo nem instalacao de ferramentas nesta API.

## Eventos e logs

O diario de transporte e persistido pelo proprio produtor, separado do diario
de auditoria existente. TUI, CLI e daemon publicam no mesmo diario. Retencao:
ultimos 1.000 eventos, numerados dentro de uma geracao persistida. Reiniciar o
servidor HTTP nao zera os IDs. O SSE suporta `Last-Event-ID`, heartbeat de 15s e
ate 16 conexoes simultaneas. O servidor consulta o diario a cada 250ms.

Eventos: `tarefa_atualizada`, `fim`, `pausa`, `ia_falhou`, `ia_trocada`,
`sessao_atualizada`. Carregam `versao`, `id`, `instante`, `tarefa`, `sessao` e
`dados`. A troca emite primeiro a falha, depois a mensagem de novo provedor.
`COMPLETED` gera fim; `CONFIRM` gera pausa. `PR_OPEN` encerra a execucao, mas nao
equivale a merge. `HALTED` gera fim com resultado falha e pode ser retomado.

Procedimento do consumidor:

1. Buscar `/v1/estado` e guardar `cursor` junto do snapshot.
2. Conectar SSE com esse `Last-Event-ID`; deduplicar por `id` e preservar ordem.
3. Ao receber evento, atualizar/consultar o recurso identificado. O snapshot e a
   autoridade, e nao a classificacao do texto de um log.
4. Em desconexao, repetir o ultimo cursor recebido. Em `409 cursor_expirado` ou
   evento de controle `reset`, buscar novo snapshot e reconectar com seu cursor.
5. Sem cursor, o stream inicia no presente e emite `pronto`; nao reenvia todo o
   passado. Consumidores lentos sao desconectados para limitar memoria.

Publicacao de evento ocorre depois da escrita do estado: falha de disco e avisada,
nao desfaz uma tarefa nem repete uma chamada paga. Isso nao e um outbox transacional.
O painel deve reconciliar periodicamente o snapshot, alem de faze-lo na reconexao.

Logs de stdout/stderr sao consultados incrementalmente por offset no endpoint de
log; nao sao todos replicados no diario SSE. O Hicode pode sondar o log da execucao
visivel a cada 250-1000ms. `proximo` e offset de bytes, nao caracteres. `reset: true`
indica que o arquivo encolheu e a exibicao deve reiniciar. Os limites nao garantem
detectar uma substituicao do arquivo por outro de tamanho igual ou maior.
Trate logs/prompts como texto nao confiavel na interface, nunca como HTML.

No Hicode, o backend repassa `Response.body` retornado por `cliente.eventos()` ao
SSE do navegador, cancelando a requisicao ao motor quando o navegador desconecta.
Repassar `Last-Event-ID` e desabilitar buffering/cache do proxy. `EventSource` do
navegador nao recebe o bearer do motor; a autenticacao de usuario fica no Hicode.

## Validacao e escopo

Testes em `test/api/http.test.ts` usam HTTP/TCP e o cliente de referencia reais,
com estado temporario. Cobrem autenticacao, origem, limites incluindo chunked,
idempotencia concorrente e apos reinicio, spec, revisao sob lock, session fechada,
contexto/subsessoes, SSE entre processos, replay, truncamento e plano consultavel.
Nao iniciam daemon nem chamam IA paga.

O Hicode em `21dae62` ainda precisa trocar seu adapter de disco/CLI por este
contrato, eliminar mutacoes paralelas, integrar seu estado de UI e validar o fluxo
no navegador. Este PR prepara o **motor**, nao declara a integracao visual pronta.
Configuracao de modelos, `/ask`, editor de planos e administracao de recursos
continuam pelas interfaces locais existentes; o novo HTTP expoe so as operacoes
listadas. A lista de provedores indica observacoes do motor, nao garante sucesso
de autenticacao remota nem validade eterna da cota.

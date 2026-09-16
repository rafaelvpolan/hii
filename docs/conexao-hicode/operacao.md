# Operacao da Conexao

[Indice](README.md) | [Protocolo completo](protocolo.md)

## Configuracao

| Variavel do motor | Padrao | Responsabilidade |
| --- | --- | --- |
| `HII_API_TOKEN` | Nenhum; obrigatoria | Segredo aleatorio de 32+ caracteres sem espacos |
| `HII_API_HOST` | `127.0.0.1` | Interface de escuta HTTP |
| `HII_API_PORT` | `8787` | Porta HTTP, entre 1 e 65535 |
| `HII_CARDS_DIR` | Resolucao local do HII | Estado usado tanto pela API quanto pelo daemon |
| `HII_REPOS_FILE` | Resolucao local do HII | Registro de projetos, compartilhado com o daemon |
| `HII_IA_FILE` | Resolucao local do HII | Preferencias do motor; nao copie outro arquivo para o painel |
| `HII_RUNNER_PIDFILE` | Resolucao local do HII | Permite ao snapshot identificar o mesmo daemon |

Defaults completos das variaveis existentes estao em [OPERACAO.md](../../OPERACAO.md).
Para o Hicode via HTTP, basta configurar URL base e token no seu backend. Nao e
necessario montar os diretorios internos do HII no container do painel. Os nomes
dessas configuracoes do adapter Hicode ainda precisam ser definidos naquele repo.

O token autentica o painel no motor; nao e a chave de Codex, Claude ou outra IA.
Use um segredo exclusivo. Injete apenas no processo API e no backend Hicode,
evitando disponibiliza-lo desnecessariamente aos processos de agentes.

## Inicializacao

1. Instalar/registrar o HII e os projetos alvo conforme o README principal.
2. Definir o token e os caminhos de estado no ambiente do servidor HTTP.
3. Executar `hii api`; sem token valido o processo falha antes de abrir a porta.
4. Fazer GET autenticado em `/v1/capacidades` e conferir protocolo/versao.
5. Fazer GET em `/v1/estado` e verificar o daemon e as conversas esperadas.
6. Iniciar o executor com `hii start` quando for desejado processar a fila.

O HTTP deve ser supervisionado separadamente do daemon, por exemplo com systemd
ou a infraestrutura de containers existente. Reinicio da API preserva o estado,
as chaves de idempotencia e os eventos retidos. Nao apagar `cards/ponte` no deploy.
O comando foi testado iniciando e encerrando com SIGTERM; nenhum servidor de teste
precisa ficar aberto para usar esta documentacao.

Se Hicode e motor estiverem em containers distintos, `127.0.0.1` de um container
nao aponta para o outro. Use rede privada e hostname do servico, bind deliberado
no motor e TLS no limite de rede apropriado. Nao publicar a porta diretamente na
internet. Esta entrega nao inclui manifests de deploy do Hicode.

## Seguranca e proxy

- Exigir autenticacao/autorizacao e protecao CSRF nas rotas do painel.
- Manter o bearer exclusivamente no backend; rejeicao de `Origin` no motor e
  uma defesa adicional, nao substitui a autenticacao do Hicode.
- Habilitar TLS fora de loopback/rede protegida. A API nao gera certificados.
- Desabilitar buffering e cache no caminho SSE; aumentar o timeout do proxy para
  streams duradouros e permitir os heartbeats de 15 segundos.
- Propagar `Last-Event-ID`, content type SSE e cancelamento por desconexao.
- Aplicar limites de requisicao no proxy. O motor limita corpo a 2 MiB e SSE a
  16 conexoes simultaneas, mas nao implementa rate limiting multiusuario.
- Guardar estado/backups com permissoes locais apropriadas. Logs e historico
  podem conter dados do projeto; nao sao considerados anonimizados.
- Ao rotacionar o token, atualizar backend e API coordenadamente. A API captura
  o token ao iniciar; mudar apenas o ambiente de outro processo nao o altera.

## Diagnostico

| Sintoma | Verificar / agir |
| --- | --- |
| API nao inicia | Token ausente/curto, porta ocupada, host invalido ou estado sem permissao |
| `401 nao_autorizado` | `Authorization: Bearer ...` e segredo iguais nos dois lados |
| `403 origem_recusada` | Navegador chamou o motor diretamente; passar pelo backend Hicode |
| `404 repo_ausente` | Registrar projeto no motor; comparar o arquivo de repos da API e daemon |
| `400 idempotencia_obrigatoria` | Preservar uma chave valida por intencao humana |
| `409 chave_reutilizada` | Nao reutilizar chave com outro corpo, rota ou If-Match |
| `409 resultado_incerto` | Houve interrupcao entre efeito e resposta; reconciliar snapshot/session, sem repetir cegamente |
| `428 revisao_obrigatoria` | Consultar recurso e enviar seu ETag em `If-Match` |
| `412 revisao_alterada` | Atualizar recurso; pedir novamente a acao com nova intencao/chave quando ainda fizer sentido |
| `409 cursor_expirado` / evento `reset` | Buscar snapshot e reconectar SSE com o novo cursor |
| `429 limite_streams` | Fechar conexoes esquecidas; cancelar upstream quando o navegador desconectar |
| Pedido existe mas nao roda | Ver `enfileirada`, mensagem da guarda e daemon no snapshot; API nao inicia executor |
| Painel parece executar para sempre | Confirmar consumo de `fim` e suporte a `COMPLETED`; nao usar enum legado |
| Falta aviso de confirmacao | Consumir `pausa` com `CONFIRM` e oferecer confirmar/recusar fecho |
| Faltam linhas de stdout/stderr | Consumir `/tarefas/{id}/log` por offset; SSE nao replica todo o log bruto |
| SSE chega em lotes atrasados | Buffering/compressao/proxy e cliente lendo `Response.body` |

IDs de session, tarefa e evento tem significados distintos. Nao usar um ID de
subsessao de provedor como ID de session HII. Ao diagnosticar, registrar status
HTTP, codigo de erro e IDs, mas nunca token, cookie ou prompt completo em log publico.

## Backup e recuperacao

Preservar em conjunto o estado do motor, `cards/sessoes`, planos/evidencias,
`cards/ponte/eventos.json` e `cards/ponte/pedidos`. Os ultimos 1.000 eventos sao
retidos; o diario de auditoria existente nao e substituido por esse buffer.
Chaves de pedidos nao tem expurgo automatico nesta versao. Um expurgo futuro deve
definir janela de retry do cliente antes de permitir reuso de uma chave antiga.

A persistencia nao e uma transacao unica entre todos os arquivos. Apos falha de
disco/crash, reconciliar snapshots e registros pendentes. Nao apagar o marcador
de idempotencia para "destravar" sem verificar se a execucao ja foi criada.

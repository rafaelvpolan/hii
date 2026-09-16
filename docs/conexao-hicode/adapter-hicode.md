# Adapter do Backend Hicode

[Indice](README.md) | [OpenAPI](openapi.json)

Este guia descreve o contrato base e a migracao das paginas legadas do Hicode.
A nova rota `/motor` e entregue separadamente em
[Hicode #22](https://github.com/rafaelvpolan/hicode/issues/22), usando a
[extensao de observabilidade v1](observabilidade.md). Isso nao migra automaticamente
as outras paginas nem significa que o candidato foi implantado.

## Responsabilidades

O backend Hicode autentica o usuario, valida seu acesso ao projeto e cria uma
instancia server-side de `clienteHii(url, token)`. Pode integrar o modulo pelo
workspace ou gerar um cliente pelo OpenAPI. O token e do servidor, nunca de um
campo `public` de configuracao nem de codigo enviado ao browser.

Substituicoes no consumidor antigo:

| Hoje no Hicode | Destino |
| --- | --- |
| `motor/cli.ts` com flags do runner | Cliente HTTP negociando `/v1/capacidades` |
| `utils/state.ts` projetando Markdown | `/v1/estado` e recursos por ID |
| `card/acoes.ts` escrevendo status | `/v1/tarefas/{id}/acoes` com ETag |
| `createSprint` chamando submit local | Session HII + pedidos identificados |
| Parser de texto para fim/pausa/troca | Eventos estruturados do motor |
| Leitura de `.live.log` no filesystem | Endpoint incremental de log |

Nao manter escrita dupla durante a migracao. Um pedido nao pode ser enviado por
HTTP e tambem criado em Markdown. O fallback CLI/disco deve ficar desabilitado
para acoes migradas; uma falha de rede nao autoriza usar outro caminho que cria
uma segunda tarefa.

## Fluxo de uma conversa

1. Validar handshake `hii-http`, versao 1; apresentar incompatibilidade explicita
   se o motor nao oferecer as capacidades esperadas.
2. Listar projetos do motor e sessions do projeto escolhido.
3. Criar uma session somente quando o usuario pedir nova conversa. Guardar o ID
   retornado como string; reutiliza-lo nos pedidos seguintes.
4. Para texto comum, enviar `{modo: 'gateway', texto}`. Para `/hii tarefa`, enviar
   `{modo: 'orquestrador', texto}`. Nao persistir um interruptor on/off.
5. Para `/hii file.spec`, o seletor/upload do Hicode entrega o conteudo do arquivo;
   enviar `{modo:'orquestrador', spec:{nome,conteudo}}`. Nao enviar caminho remoto.
6. Usar o `id` da resposta para acompanhar a execucao, mantendo a session aberta.
7. Consultar historico/subsessoes da session para renderizar provedores/modelos,
   mensagens e chamadas sucessivas sem criar outra conversa por troca de IA.
8. Fechar por `/sessoes/{id}/fechar` quando solicitado. A confirmacao do motor,
   e nao um clique otimista no cliente, autoriza mostrar `#077 closed`.

`POST /v1/ask` oferece consulta readonly identificada, sem criar card executavel.
Negocie a capacidade anunciada antes de usa-la; veja o contrato da extensao.

## Acoes humanas

Exemplo usando o cliente de referencia, em uma rota autenticada do backend:

```ts
const consulta = await motor.tarefa(idDaExecucao)
await motor.agir(idDaExecucao, 'parar', 'pedido do usuario', chaveDaIntencao, consulta.etag)
```

Uma retentativa de transporte repete a mesma chave, corpo e ETag. Depois de `412`,
buscar novo estado e reavaliar a intencao; nao aprovar automaticamente o novo
estado apenas para obter resposta 200. `parar` nao significa `fechar session`.
`CONFIRM` exige `confirmar-fecho` ou `recusar-fecho`; `URL` exige as acoes de URL.
Os controles devem ser habilitados por estado e pela lista de acoes suportadas.

## SSE e atualizacao da tela

Buscar snapshot antes do stream e enviar seu cursor como `Last-Event-ID`.
O metodo `motor.eventos(cursor, signal)` devolve uma `Response` cujo body pode ser
repassado pelo backend como stream. Nao chamar `.json()` nem acumular `.text()`
nessa resposta, pois ela permanece aberta.

No proxy do Hicode:

- Autenticar/autorizar a rota antes de abrir o upstream.
- Passar o cursor, mas nao repassar todos os headers do navegador ao motor.
- Retornar `Content-Type: text/event-stream` e desabilitar cache/buffering.
- Cancelar o `AbortController` do upstream quando o navegador sair.
- Converter erros HTTP antes do inicio do stream em resposta apropriada, sem
  expor credenciais ou stack traces.

Renderizacao dos eventos:

| Evento | Acao esperada no painel |
| --- | --- |
| `tarefa_atualizada` | Atualizar estado da execucao por ID |
| `sessao_atualizada` | Buscar a session e atualizar mensagens/subsessoes |
| `ia_falhou` | Mostrar o motivo resumido da falha |
| `ia_trocada` | Mostrar `mudando automaticamente para ...`, sem encerrar a session |
| `fim` + `COMPLETED` | Encerrar o indicador de execucao; session permanece aberta |
| `fim` + `HALTED` | Mostrar interrupcao e possibilidade de retomada conforme estado |
| `pausa` + `CONFIRM` | Mostrar decisao humana de fechamento |
| `pronto` | Controle de conexao iniciada no presente, nao tarefa iniciada |
| `reset` | Descartar cursor de transporte, obter snapshot e reconectar |

Deduplicar por ID de evento. Reconectar usando o ultimo ID recebido, sem repetir
o POST que iniciou a tarefa. A perda de stream nao significa falha da execucao.
Ainda fazer reconciliacao periodica pelo snapshot: nao existe outbox transacional.
O stream v1 e global ao motor, nao filtrado por projeto. Nao o repasse inteiro a
usuarios com acesso parcial: o backend precisaria filtrar e autorizar o repasse, ou usar
instancias separadas. A API atual foi preparada para um unico operador.

## Logs e recursos

Consultar o log somente das execucoes visiveis e guardar `proximo` por execucao.
O valor e offset em bytes. Em `reset`, reiniciar a exibicao. Pausar polling quando
a tela sair de foco ou a execucao terminar, sem apagar o historico da session.
Renderizar texto de log e respostas de agentes com escape, nunca `innerHTML`.

`/v1/provedores` mostra disponibilidade/modelos conhecidos; `/v1/recursos` mostra
o catalogo descoberto para o provedor ativo e projeto. Descoberta nao e instalacao
nem uma chamada de agente. A extensao oferece configuracao tipada com revisao
em `/v1/configuracao`, mediante autorizacao administrativa; nao escrever `ia.json`
pelo painel como atalho.

`/v1/tarefas/{id}/plano` expoe o plano e relatorio persistidos. O campo
`atualidadeVerificada: false` impede confundir leitura com revalidacao do trabalho.
A extensao aceita revisoes por POST com tarefa parada, ETag e idempotencia;
salvar uma revisao nao aprova nem inicia automaticamente sua execucao.

## Criterios de aceite do Hicode

- Session nova e segundo pedido na mesma session, sem duplicacao por retry.
- Texto gateway e tarefa/spec orquestrado, com modo visivel correto.
- Troca de provedor: falha e troca aparecem em ordem e historico continua unido.
- `COMPLETED` encerra indicador; `CONFIRM` aguarda acao humana real.
- Reinicio/reconexao SSE nao perde estado nem executa outro POST.
- `412` e chave reutilizada sao tratados sem sobrescrever mudancas do motor.
- Cancelar/retomar nao duplica trabalho; session ocupada nao fecha.
- Token nao aparece no bundle, URL, log publico nem resposta ao navegador.
- Testes de navegador desktop/mobile com harnesses falsos, alem dos testes HTTP.

Somente depois desses testes a integracao visual pode ser considerada concluida.

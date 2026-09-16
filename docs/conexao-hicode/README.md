# Conexao Hicode / Motor HII

Esta pasta e a referencia da comunicacao entre o painel Hicode e o motor HII.
O protocolo escolhido e **HTTP/JSON + SSE v1**, com autenticacao no backend.

## Documentos

| Documento | Conteudo |
| --- | --- |
| [Protocolo](protocolo.md) | Decisao arquitetural, alternativas, endpoints, payloads, idempotencia, revisoes, eventos e limites |
| [Operacao](operacao.md) | Variaveis, inicializacao, seguranca, proxy, diagnostico e recuperacao |
| [Adapter Hicode](adapter-hicode.md) | Como migrar o consumidor, fluxo de session, comandos, SSE e logs |
| [OpenAPI](openapi.json) | Contrato legivel por ferramentas para gerar clientes e consultar schemas |
| [Diagnostico inicial](diagnostico-inicial.md) | Evidencias das incompatibilidades do antigo adapter de CLI/disco, com SHAs verificados |

## Arquitetura

```text
Navegador
   | sessao autenticada do painel
   v
Backend Hicode
   | Authorization: Bearer <segredo do servidor>
   | HTTP/JSON: comandos e consultas
   | SSE: eventos; GET incremental: logs
   v
API HII (hii api)
   | mesmas operacoes usadas pela CLI/TUI
   v
Estado e fila do HII <---- daemon de execucao (hii start)
   |                          |
   |                          +-- provedores / agentes / worktrees
   +-- sessions, execucoes, subsessoes, planos e evidencias
```

A API recebe pedidos e enfileira, mas nao substitui o daemon. A session pertence
ao HII, nao a um provedor. Cada session pode conter diversas execucoes e subsessoes
de IA. O Hicode nao deve manter uma segunda maquina de estados nem editar Markdown.

## Estado da entrega

Implementado no HII: servidor autenticado, handshake de versao/capacidades,
sessions, pedidos gateway/orquestrador por texto ou spec, acoes humanas,
snapshot, catalogos de leitura, plano/evidencias, log incremental, eventos com
cursor duravel, idempotencia e cliente TypeScript de referencia.

**Ainda pendente no Hicode:** substituir seu adapter de CLI/disco por HTTP,
conectar os controles e o estado da interface, remover escritas paralelas e
validar o fluxo no navegador. Preparar o motor nao equivale a implantar o painel.
Nao foram feitas chamadas de IA paga para validar esta conexao.

## Codigo e verificacao

- [Servidor](../../motor/api/servidor.ts) e [cliente](../../motor/api/cliente.ts).
- [Contrato fonte](../../motor/api/openapi.ts) e [operacoes](../../motor/api/operacoes.ts).
- [Idempotencia](../../motor/api/idempotencia.ts) e [diario de eventos](../../motor/euclides/ponte-eventos.ts).
- [Testes HTTP/SSE](../../test/api/http.test.ts) e [testes CLI/contrato](../../test/api/cli.test.ts).

Comandos na raiz do HII:

```bash
bun scripts/exportar-api.mjs
bun test test/api/http.test.ts test/api/cli.test.ts
node --test --test-timeout=30000 test/api/http.test.ts test/api/cli.test.ts
bun run typecheck
```

Para a suite ampla, use `bun run test:unit` e `bun run test:node` (isolamento por
arquivo conforme o repositorio). O visualizador geral permanece em
[processo-orquestracao.html](../processo-orquestracao.html), com uma secao da conexao.

Mudancas incompativeis no protocolo devem ganhar nova versao, sem retirar campos
ou significados de v1 silenciosamente. Ao alterar endpoints/schemas, atualizar o
contrato fonte, exportar novamente o JSON, atualizar o cliente e rodar os testes.

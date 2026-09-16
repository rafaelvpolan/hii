# Entrega parcial das issues — 16/09/2026

Esta entrega **não conclui todas as issues** nem comprova funcionamento integral
do produto. Base: `origin/main` em `1808306`. Nenhum daemon, fila ativa,
credencial, instalação global ou preferência do operador foi alterado.

## Mudanças implementadas

- #59/T3: leitura paginada com `gh api --method GET --paginate --slurp`,
  filtragem de PRs, validação dos registros, identidade por instância/repositório
  e número. Falha de qualquer página recusa a importação inteira.
- #47/#59: cards novos carregam o repositório e a origem completa. Cards legados
  sem repo são diagnosticados como ambíguos; não são remapeados automaticamente.
  Comentários usam o destino da origem, com a proteção de idempotência existente.
- #59: resposta Ollama sem documento válido falha; HTTP de erro é detectado;
  tokens inválidos não são contabilizados. Somente a resposta pública validada
  chega ao callback de observabilidade. Não foi implementado streaming.
- #49: fallback de gate/verify exige leitura isolada e JSON estruturado.
  Pedidos de outros papéis podem exigir JSON explicitamente.
- #54/#59 + hicode#24: capacidades anunciam leitura/escrita de configuração
  conforme admin e escopo da credencial, além da aptidão real de cada harness.
  A API recusa provedor incapaz de editar/verificar e aceita modelo vazio como
  retorno à seleção padrão.

## Validação

Ambiente WSL Ubuntu, Node 24.17.0 e Bun 1.4.0 (cache npm; runtime global preservado).

- `bun run typecheck`, `bun run lint:types`, `bun run lint:clone`.
- `HII_TEST_JOBS=1 bun run test:unit`: 323 arquivos, **3222 pass / 0 fail**.
- `bun run test:node`: **3184 + 30 pass / 0 fail** na rodada completa.
- Após extensão do roteador: 43 testes Node de rota/API/fallback passaram.
- E2E Hicode ↔ fixture HII: desktop 1365px e mobile 390px, configuração,
  conflito ETag, preservação da proposta humana, autenticação, SSE, ask readonly,
  XSS e ausência do token no navegador.
- Uma rodada Bun concorrente apresentou falha temporal no encerramento de
  processo real. O arquivo passou isoladamente (12/12) e na suíte serial.
- Sem inferência paga, sem GPU/modelo real e sem teste de isolamento de ferramentas.

## Inventário de conclusão

| Issue | Situação nesta entrega |
| --- | --- |
| #46 | Épico permanece aberto; não concluído. |
| #47 | Identidade externa melhorada; contrato completo e round-trip de produto ainda pendentes. |
| #48 | Setup/provisionamento idempotente não implementado nesta entrega. |
| #49 | Filtro de capacidades corrigido; paralelismo isolado e recuperação integral pendentes. |
| #50 | Gates executados; critérios amplos de evidência/TUI não concluídos nesta entrega. |
| #51 | Revisão multiavaliador/PR gerenciado não implementados nesta entrega. |
| #54 | Negociação de configuração ampliada; não auditados todos os critérios do plano. |
| #59 | Incrementos de T3 e adaptador/API; T1, T2 semântico, T4–T7 e piloto local pendentes. |

## Operação e reversão

A configuração HTTP só permite escrita com API administrativa explícita e sem
escopo restrito a repos. A preferência vale para novos despachos. O painel antigo
ignora os campos aditivos; o painel novo degrada para acompanhamento em motor antigo.

`HII_TASK_SYNC` continua sendo opt-in; nenhuma sincronização real foi executada.
Antes de reverter a ponte para uma versão que só usa números, desabilite o sync:
origens novas não devem ser reimportadas como cards independentes. Preserve os
cards e o diário. Origem legada só pode publicar após associação explícita de
`card.repo` e `HII_GH_REPO` ao mesmo projeto.

Ollama continua não agentivo. Hostname privado não comprova inferência local.
Esta entrega não oferece `somente_local`, sandbox de ferramentas, downloads,
tracker contínuo, exactly-once para efeitos ambíguos ou merge automático.

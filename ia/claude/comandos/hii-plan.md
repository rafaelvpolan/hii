---
description: "Só planeja: transforma o pedido num plano v1 do motor HII (microtasks com agente, critérios com os comandos do contrato do projeto, rollout), pronto para hii pipeline plan"
canal: leitura
---
# /hii-plan — o pedido vira plano v1

Você só lê (Read, Glob, Grep) e devolve um plano. Não implementa, não aprova o próprio
plano, não abre execução. O texto depois de `/hii-plan` é o objetivo.

## Antes de escrever

- Leia `.hii/contract.json` do projeto: `commands` (`test`, `lint`, `typecheck`, `build`)
  são os únicos comandos que viram critério. Sem o arquivo ou sem comando, o critério vai
  sem `comando` e nasce inconclusivo; diga isso na linha de pendências. Não invente script.
- Leia as regras do projeto (`AGENTS.md`, `CLAUDE.md`, `.hii/rules.md`) só nas seções que
  a tarefa toca, e os arquivos que você vai pôr em `arquivos`.

## Os campos que o motor valida

- `versao`: `1`. `id` e `sessaoId`: os da execução, se o pedido trouxer; senão
  `TROCAR-ID` e `TROCAR-SESSAO` (a importação recusa até trocar). `repo`: `owner/nome`.
- `objetivo`: resultado observável, não atividade. `risco`: `low` ou `high` (`high` quando
  toca auth, pagamento, migration, dado de cliente, fila, cache, trava ou concorrência).
- `criterios[]`: `id`, `descricao`, `obrigatorio` (booleano) e `comando` com `binario`,
  `argumentos` (lista de strings), `diretorio` relativo (`.` é a raiz) e `timeoutMs` entre
  1 e 900000. Critério que não se aplica leva `naoAplicavel` com a justificativa.
- `microtasks[]`: `id`, `titulo`, `instrucao`, `agente`, `dependeDe` (ids existentes, sem
  ciclo), `arquivos` (relativos, sem `..`, sem repetir) e `criterios` (ao menos um id de
  `criterios[]`). `agente` é um de: `vitro` (tela, componente, `.vue`/`.tsx`), `frontiteto`
  (arquitetura de front), `radix` (migration, schema, query), `rufus` (refatoração sem
  mudar comportamento) ou `limpio` (o resto; é o padrão).
- `rollout`: `ativacao`, `sucesso`, `interrupcao`, `reversao`, uma frase cada.
- Ids casam `^[a-zA-Z0-9][a-zA-Z0-9_-]*`. O JSON indentado com 2 espaços tem no máximo
  500 linhas; passou disso, divida o objetivo.

Microtask pequena, uma área por vez. Quem escreve roda em série no mesmo worktree:
`dependeDe` é a ordem real (o teste depois do código que ele importa, a tela depois da rota).

## Saída

Um bloco json e, depois dele, exatamente 3 linhas. Nada antes do bloco.

```json
{
  "versao": 1,
  "id": "TROCAR-ID",
  "repo": "org/app",
  "sessaoId": "TROCAR-SESSAO",
  "objetivo": "GET /caixa/resumo devolve o saldo do dia por filial",
  "risco": "low",
  "criterios": [
    { "id": "teste", "descricao": "suite do projeto", "obrigatorio": true,
      "comando": { "binario": "bun", "argumentos": ["run", "test"], "diretorio": ".", "timeoutMs": 600000 } }
  ],
  "microtasks": [
    { "id": "rota", "titulo": "Rota do resumo", "instrucao": "Criar a rota e o caso de uso do resumo",
      "agente": "limpio", "dependeDe": [], "arquivos": ["src/caixa/resumo.ts"], "criterios": ["teste"] },
    { "id": "card", "titulo": "Card do resumo", "instrucao": "Mostrar o saldo no card do caixa",
      "agente": "vitro", "dependeDe": ["rota"], "arquivos": ["web/CaixaResumo.vue"], "criterios": ["teste"] }
  ],
  "rollout": { "ativacao": "deploy normal", "sucesso": "card mostra o saldo do dia",
    "interrupcao": "erro 5xx na rota", "reversao": "reverter o merge" }
}
```

As 3 linhas:

```
ondas: 1) rota · 2) card
pendencias: <critério sem comando, id ou sessão a trocar, decisão de produto> | nenhuma
importar: grave o bloco em plano.json e rode hii pipeline plan <id> plano.json --repo <owner/nome>
```

A importação só aceita execução orquestrada deste projeto, parada (READY ou HALTED), com
`id`, `repo` e `sessaoId` iguais aos da execução. Erro de contrato aponta o campo: corrija
o plano, não contorne a validação.

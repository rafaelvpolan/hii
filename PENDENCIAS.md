# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## 1. O painel não consegue CRIAR tarefa (lacuna do contrato de máquina)

`hii estado`, `hii responder`, `hii approve/reject/halt` cobrem **ler, responder e decidir**. Falta a
porta de **disparar**: `core.submit()` (`lib/core/actions.ts:33`) só é chamado pelo dispatch da TUI
(`lib/core/dispatch.ts:196`). Não há comando de CLI que crie card.

Sem isso o painel lê o motor mas não o aciona — que é metade do que ele precisa.

**O que fazer:** `hii tarefa nova "<texto>" --repo <owner/nome> [--json]`, devolvendo o id criado.
Decidir se passa pela leitura de intenção (`classificarPrompt`, que gasta IA e pode virar pergunta em
vez de tarefa) ou se é sempre tarefa, como o `/new-task`. Recomendação: sempre tarefa — o painel já
sabe que é tarefa, e classificar de novo gasta IA sem necessidade.

Verificar: criar por CLI num estado isolado, conferir o card em disco e o id no `hii estado --json`.

---

## 2. Custo por fase não fecha com custo por papel

`runGatedStep` (`lib/runner/gated.ts`) roda **duas** IAs no mesmo passo — o agente e o revisor crivo —
e soma tudo numa `StepMetric` só. Então `Run.steps` (visão de progresso) e `Run.ias` (ledger, fonte de
verdade das IAs) não batem, e ninguém consegue dizer quanto do passo foi agente e quanto foi gate.

**O que fazer:** separar as duas chamadas em métricas distintas dentro do passo, ou aceitar
explicitamente que `steps` é tempo/progresso e parar de somar custo nele. A segunda é mais honesta e
mais barata.

---

## 3. Teste intermitente sem diagnóstico

Numa rodada da suíte apareceu `1 fail / 1 error` que **não reproduzi** em ~13 rodadas completas
seguintes. Única evidência: a rodada vermelha teve 5 `expect()` a menos que a verde, ou seja o teste
abortou cedo. Sem o nome não dá para ir além.

**O que fazer:** quando reaparecer, capturar o nome (`bun test ./test 2>&1 | tee` e guardar o log)
antes de qualquer outra coisa. Suspeita não confirmada: estado compartilhado entre arquivos — o bun
roda todos no MESMO processo, então env e módulo com estado vazam. Já fechei um vazamento assim
(`HICODE_DISCO_TETO_MB` em `test/refs-anexo.test.ts`), pode haver outro.

---

## 4. Clipboard: só o caminho do WSL foi verificado de verdade

`colarImagem` (`lib/runner/clipboard.ts`) tem quatro backends. Verificado em execução real **apenas o
WSL** (`powershell.exe Get-Clipboard -Format Image` + `wslpath`), pondo uma imagem no clipboard do
Windows e conferindo o PNG em disco. `wl-paste` (Wayland), `xclip` (X11) e `pngpaste` (macOS) estão
cobertos **só por teste com mock** — esta máquina não tem nenhum dos três instalados.

**O que fazer:** rodar `hii` numa máquina Linux com Wayland ou X11 e num mac, e conferir
`/ref clipboard` de ponta a ponta. Até então, tratar esses três como não verificados.

---

## 5. `Run.provider` e `Run.model` no topo do registro perderam função

Com o ledger, quem responde "quais IAs participaram" é `Run.ias`. O topo do registro guarda um
provedor só — o do implement — e numa run real em disco o `model` sai **vazio**. `contribuicoesDoRegistro`
ainda usa o topo como fallback para execuções antigas, e `anotarLimite` usa `Run.provider` para saber
de quem é o limite de cota.

**O que fazer:** decidir entre (a) preencher os dois corretamente e manter como "quem implementou", ou
(b) tirar do schema e derivar tudo do ledger, mantendo o fallback só para registros antigos. O
incômodo real hoje é o limite de cota: se o gate estourar a cota, `Run.provider` aponta para o
implement, e a marca de limite vai para o provedor errado.

---

## 6. Registro de conversa e ledger acumulam sem poda

Cada sessão de TUI que faz pergunta gera `cards/runs/conversa-<sessao>.json` e um
`<sessao>.ias.jsonl`. `hii archive` arquiva **cards**; `hii disco --limpar` limpa **tmp/**. Ninguém
poda conversa nem ledger antigo.

**O que fazer:** dar TTL ao registro de conversa (por exemplo, fora da janela de 7 dias do histórico) e
podar junto no tick, do mesmo jeito que `podarTmp`. O indicador de disco já mede a área `runs`, então o
sintoma aparece antes de virar problema.

---

## 7. Painel: push em vez de polling (se e quando doer)

O contrato de hoje é polling barato: o painel guarda `hii estado --revisao` e só relê o snapshot quando
o token vira. Serve, é local, e não acrescenta processo nem porta ao motor.

**Só fazer se o polling doer de verdade.** Seria SSE/HTTP em cima do mesmo snapshot, sem mudar o
contrato — e traz servidor, porta e superfície de auth para dentro do motor, o que contraria o escopo
(execução, revisão, verificação e roteador de IAs).

---

## 8. Miudezas

- `phaseLabel('CLARIFY')` devolve o próprio status em vez de rótulo humano — o painel mostra `CLARIFY`
  cru no campo `fase` (`lib/core/render/phases.ts`).
- A tela `/config` mostra consumo por provedor, mas não o ledger da sessão; o detalhe por papel só
  aparece no histórico, com a sessão selecionada.
- `tsconfig.json` não liga `noUnusedLocals`/`noUnusedParameters`. `lib/` e `bin/` estão limpos hoje,
  mas nada impede a volta do import morto. Ligar as duas flags fecharia a porta — vale conferir se os
  testes passam com elas antes de commitar a mudança.

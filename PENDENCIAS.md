# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## Rename da Onda 1 cega a deteccao de "sem teste correspondente"

**Sintoma.** `temTesteCorrespondente` (hoje `motor/agentes/ass/auditoria.ts`,
ate 1.8 em `lib/runner/auditoria.ts`) casa fonte com teste pelo **stem do nome
do arquivo**: `finish.ts` casa com `test/finish-cost.test.ts`. A Onda 1
renomeia o fonte (`finish.ts` -> `motor/qlb/ctr/fechar.ts`) e deixa o nome do
teste como esta, por decisao explicita (R4 — nome de arquivo de teste nao muda
na Onda 1). Resultado: o auditor passa a reportar `sem teste correspondente`
para arquivos que **tem** teste.

**Quanto dói.** Nao quebra build nem gate; degrada um relatorio. Mas e
falso-negativo silencioso, que e justamente o tipo de coisa que este motor
existe pra nao ter.

**Duas saidas, nenhuma dentro da Onda 1.**
1. Renomear os arquivos de teste junto com o fonte. Coerente, mas e uma onda
   propria: 151 arquivos, e mistura dois riscos (R3).
2. Trocar a heuristica de stem por um mapa explicito fonte->teste, ou por
   leitura dos imports do teste. Mais robusto, e resolve tambem os testes que
   ja hoje nao casam por nome.

**Enquanto isso.** Nao confie na coluna `semTeste` do auditor para codigo
sob `motor/`.

---

## Flake de isolamento entre arquivos de teste

**Sintoma.** Rodando a suíte inteira (`bun test ./test`), esporadicamente aparece
`# Unhandled error between tests` com
`nao deveria chamar runStep — steps: nada nao roda nenhum passo`.
Observado 1 vez em 2 rodadas completas durante o baseline da Onda 0 do
`WORKFLOW-EXECUCAO.md`. Os três arquivos que contêm essa mensagem
(`finish-cost`, `finish-pushed-sha`, `finish-wait-attempts`) passam 6/6 quando
rodados isolados — a falha só existe na suíte completa.

**Onde mexer.** Os 34 arquivos que escrevem card definem
`process.env.HICODE_CARDS_DIR` no **topo do módulo**, como global do processo.
O guarda `test/isolamento-de-testes.test.ts` cobra que a variável seja isolada,
mas não que o isolamento sobreviva a outro arquivo carregado depois. A hipótese
mais provável é uma promessa de `handleExecute`/`handleFinish` que completa
depois do fim do teste que a criou, já com o env apontando para o diretório de
outro arquivo.

**Por que dói.** Enquanto existir, uma reprovação de `bun run test` não
distingue defeito real de flake — o que enfraquece o gate por commit da Onda 1
(ver R2 no `WORKFLOW-EXECUCAO.md`, que hoje carrega a mitigação de reproduzir
duas vezes).

**Não fazer junto com o rename.** É investigação própria, em 34 arquivos, e
misturar com a Onda 1 quebra a R3.

---

As duas últimas saíram daqui porque não eram trabalho pendente, e sim conhecimento que pertence ao
README: a ressalva de que só o clipboard do WSL foi verificado em execução real está junto do
`/ref clipboard`, e a decisão de manter polling em vez de push está junto do contrato de máquina.

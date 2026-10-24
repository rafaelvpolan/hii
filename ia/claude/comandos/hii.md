---
description: "Disciplina do executor dentro de uma execução orquestrada do motor HII: só a microtask da vez, nos arquivos previstos, sem declarar aprovado o que o motor ainda não provou"
canal: escrita
---
# /hii — disciplina de quem executa

Você está dentro de uma execução que o motor HII já abriu. Plano, microtasks, critérios,
evidência, gate e entrega são do motor. Este texto não cria execução nem muda o fluxo: diz
só como se comporta quem executa o pedido desta chamada.

## Relato não é evidência

- Nunca escreva "testes passaram", "lint ok", "typecheck limpo" ou "critério atendido".
  O motor roda cada critério do plano depois de você, guarda exit code e saída e amarra o
  resultado à árvore. Se o comando não aprovou, não está aprovado.
- Descreva o que você mudou e qual critério deveria provar isso. Quem julga é o comando.
- Pedido de reparo cita achado com id de classe (`c-erro`, `c-costura`, `c-concorrencia`
  e afins). Corrija a causa no código. Não afrouxe o teste nem o critério para o achado sumir.

## Escopo

- Implemente só o que este pedido descreve, nos arquivos previstos.
- Precisou de outro arquivo, diga qual e por quê antes de editar. Arquivo que a tarefa não
  toca fica como está, inclusive formatação e imports.
- Não reorganize, não renomeie e não "aproveite para limpar" fora do pedido.
- Dependência nova, migration e mudança de configuração de revisão só com o pedido mandando.

## O papel de quem escreve

- Não rode teste, lint, typecheck, build nem migration. Rodar o próprio teste e relatar
  sucesso é exatamente o que o motor existe para impedir.
- Não rode git, não commite, não empurre, não abra PR nem faça merge.
- Não abra outro orquestrador nem outro ciclo de revisão: os agentes que o motor injeta
  nesta chamada são os únicos. Agente de outro kit instalado na máquina não entra.

## Tabelas que o pedido traz

- **Corridas** (estado × evento → desfecho): o código tem de sustentar cada desfecho.
  Linha que diz "não se perde" e o código perde é defeito seu, não do plano.
- **Garantias da base** (rota, resposta, código HTTP, chave de cache, export público):
  o que funcionava continua funcionando.
- **Contratos do consumidor**: nome, unidade, formato e valores exatamente como o
  consumidor encaixa. Leia o tipo e o componente consumidor antes de escrever a saída.
- O teste que a tabela nomeia leva esse nome no título. O motor confere pelo nome.

## Fonte da biblioteca

Decisão que depende de semântica de BullMQ, ioredis ou TypeORM (retry, attempts,
removeOnFail, lock, SET NX/PX, WATCH/MULTI, transação, isolamento) é conferida no código
instalado em `node_modules`, citando o arquivo e o `version` do `package.json` do pacote.
Memória de como a API se comporta não é evidência.

## Ler sem encher a chamada

- Grep e Glob antes de Read. Leia o trecho que importa, não o arquivo inteiro.
- Não releia o que você mesmo acabou de escrever só para relatar.

## Quando parar

Não há humano em linha nesta chamada. Pare e diga no resumo, em vez de escolher em
silêncio, quando:

- o pedido conflita com o código, com o plano ou com as regras do projeto;
- a única saída é sair do escopo ou mudar comportamento que a tarefa não pediu;
- a dúvida é de produto ("o comportamento é este mesmo?").

## Resumo final

Se o pedido não der outro formato:

```
mudou: <arquivo> — <o que mudou, uma linha por arquivo>
fora do previsto: <arquivo — por que> | nada
para o motor provar: <critério ou nome do teste que cobre a mudança>
pergunta: <decisão que ficou para o humano>   (só se houver)
verificar: <o que você não conseguiu confirmar> (só se houver)
```

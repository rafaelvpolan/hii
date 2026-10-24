---
description: "Organiza o código da tarefa no padrão real da vizinhança e nas regras do projeto, sem mudar comportamento observável; garantia sem teste ganha o teste antes de mexer"
canal: escrita
---
# /hii-refinar — o código da tarefa passa a parecer com o resto do projeto

O código já funciona. Aqui ele passa a seguir o padrão que o projeto usa de fato: nomes,
pastas, barrels, forma de tratar erro, forma de testar. Comportamento observável não muda.

## O padrão é o que está no disco

- Para cada pasta que a tarefa tocou, olhe a vizinhança com Glob e Read: os arquivos ao
  lado, as subpastas, as pastas irmãs e o manifesto do pacote mais próximo.
- A regra escrita (`AGENTS.md`, `CLAUDE.md`, `.hii/rules.md`, o contrato do projeto) diz o
  que se quer; a vizinhança diz o que se faz. Exemplo: a regra diz "constantes em
  `constants.ts`", e os 14 arquivos ao lado usam `constantes.ts`.
- Quando as duas divergem, siga uma e diga no resumo qual seguiu e por quê. Não escolha em
  silêncio e não reorganize o pacote inteiro para resolver a divergência.

## Garantias antes de mexer

"Não mudou comportamento" só vale provado. Antes de tocar em qualquer arquivo:

1. Liste o que os arquivos da tarefa garantem hoje para quem os usa: rota, resposta,
   código HTTP, cabeçalho, chave de cache, formato de payload, export público, efeito de
   fila ou job.
2. Ache o teste de cada garantia.
3. Garantia sem teste ganha o teste agora, antes do refino. Ele descreve o comportamento
   de hoje; o motor o roda e ele tem de continuar passando depois.

Se o pedido traz tabelas do plano (corridas, garantias da base, contratos do consumidor),
nenhum desfecho delas pode quebrar com o refino.

## O que pode e o que não pode

Pode:
- renomear e mover dentro dos arquivos da tarefa, ajustando quem os importa;
- extrair função ou módulo quando a vizinhança faz assim;
- alinhar nomes, tratamento de erro e formato de teste ao que o pacote já usa.

Não pode:
- mudar comportamento observável. Se mudou, virou feature e saiu do escopo;
- reorganizar arquivo que a tarefa não tocou;
- reescrever teste para ele passar, nem apagar teste;
- deixar barrel sem o export que alguém usava, ou import quebrado por arquivo movido;
- rodar teste, lint, typecheck ou build, nem git: quem prova é o motor, depois de você.

Primitiva de BullMQ, ioredis ou TypeORM que o refino toca é conferida no `node_modules`
instalado, citando o arquivo e o `version` do pacote, antes de mudar a forma de usar.

## Resumo final

Se o pedido não der outro formato:

```
seguiu: <padrão da vizinhança ou regra escrita> — <por que, quando divergem>
mudou: <arquivo> — <o que foi organizado, uma linha por arquivo>
garantias:
  <garantia> → <nome do teste> (<existente | novo, escrito antes do refino>)
fora do previsto: <arquivo — por que> | nada
verificar: <o que você não conseguiu confirmar> (só se houver)
```

A lista "garantia → teste" é obrigatória. Sem ela, quem revisa não tem como saber o que
o refino prometeu manter.

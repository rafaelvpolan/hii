---
id: background-jobs
papeis: [implementador, planejador, avaliador]
arquivos: ["**/jobs/**", "**/workers/**", "**/queues/**", "**/tasks/**", "**/consumers/**", "**/*.worker.*"]
deps: ["bullmq", "bull", "celery", "sidekiq", "kafkajs", "amqplib", "@aws-sdk/client-sqs", "agenda"]
---
**Fila entrega pelo menos uma vez.** Exatamente-uma-vez é propriedade do
consumidor, não do broker — quem promete isso na configuração está descrevendo
o caso feliz.

## O consumidor é idempotente, ou a mensagem duplicada cobra duas vezes

Redeploy, timeout de confirmação e rebalanceamento de partição reentregam
mensagem que já foi processada. O consumidor guarda a chave do trabalho feito e
reconhece a repetição — antes de causar o efeito, não depois.

## Mensagem venenosa precisa de saída

Mensagem que sempre falha e sempre volta para a fila consome o worker para
sempre e esconde o resto do trabalho. Teto de tentativas e fila de descarte
(*dead letter*), com o motivo da última falha junto. Fila de descarte sem
ninguém olhando é o mesmo que apagar.

## Ordem não é garantida a menos que você pague por ela

- Fila comum não preserva ordem entre mensagens. Se a ordem importa, ela vem de
  chave de partição — e isso limita o paralelismo àquela chave.
- Trabalho que depende de ordem costuma ser trabalho que deveria carregar o
  estado esperado na própria mensagem.

## O que vai na mensagem

- Identificador e o mínimo para refazer o trabalho, não o objeto inteiro.
  Carga grande estoura limite do broker e envelhece entre a publicação e o
  consumo.
- Nunca segredo em claro no corpo da mensagem: a fila é persistida e costuma
  ser visível a mais gente que o banco.
- Versione o formato. Worker antigo vai consumir mensagem nova durante o deploy.

## Agendamento

- Tarefa periódica em mais de uma réplica roda mais de uma vez. Ou o agendador é
  único, ou a tarefa toma um bloqueio com prazo.
- Fuso e horário de verão quebram agendamento expresso em hora local. Guarde em
  UTC e converta na borda.

## O que medir

Profundidade da fila e **idade da mensagem mais velha**. Profundidade sozinha
não distingue pico absorvido de fila parada: mil mensagens que somem em um
minuto e mil que estão lá desde ontem dão o mesmo número.

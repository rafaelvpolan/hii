---
id: backend-reliability
papeis: [implementador, planejador, avaliador]
arquivos: ["**/services/**", "**/clients/**", "**/handlers/**", "**/api/**", "**/routes/**", "**/middleware/**"]
deps: ["axios", "got", "undici", "node-fetch", "express", "fastify", "nestjs", "@nestjs/core"]
---
**Toda chamada de rede falha, e a maioria das falhas de produção é a resposta
errada a essa falha — não a falha em si.**

## Timeout é obrigatório, e não é o padrão

Cliente HTTP sem timeout explícito espera para sempre em boa parte das
bibliotecas. Uma dependência lenta sem timeout vira fila crescente, pool de
conexões esgotado e queda de um serviço que estava saudável.

- Todo cliente declara timeout de conexão e de leitura.
- O timeout de quem chama é **menor** que o de quem é chamado. Invertido, o
  chamador desiste depois de o trabalho já ter sido feito e ninguém aproveita.

## Retry sem cuidado transforma incidente pequeno em queda geral

- Só operação **idempotente** é repetida. Repetir `POST` de cobrança sem chave
  de idempotência cobra duas vezes.
- Espera exponencial **com jitter**. Sem jitter, todos os clientes voltam no
  mesmo instante e reproduzem o pico que derrubou o serviço.
- Teto de tentativas e teto de tempo total. Retry infinito é indisponibilidade
  com outro nome.
- Erro 4xx (menos 429) não se repete: a resposta não muda.

## Disjuntor e anteparo

- Quando a dependência já está falhando, insistir gasta recurso do chamador. O
  disjuntor abre, devolve erro rápido, e testa de novo depois de um intervalo.
- Separe pools por dependência. Um pool único deixa o serviço lento derrubar o
  acesso ao serviço saudável.

## Desligamento gracioso

`SIGTERM` chega em todo deploy, não só em incidente. O processo para de aceitar
conexão nova, termina o que está em voo dentro de um prazo, fecha pool e sai.
Sem isso, cada deploy devolve erro para quem estava no meio de uma requisição.

## Sonda de saúde diz a verdade

Sonda que devolve `200` fixo não é sonda. Ela reflete o que o processo precisa
para servir — e distingue **vivo** (não travou, não reinicie) de **pronto**
(pode receber tráfego). Confundir os dois faz o orquestrador reiniciar um
processo que só estava aquecendo.

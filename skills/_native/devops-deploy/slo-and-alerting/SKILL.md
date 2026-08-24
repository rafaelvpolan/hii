---
id: slo-and-alerting
papeis: [planejador, avaliador, implementador]
arquivos: ["**/alerts/**", "**/*.rules.y*ml", "**/prometheus*", "**/grafana/**", "**/monitoring/**", "**/slo*", "**/dashboards/**"]
deps: ["prom-client", "@opentelemetry/sdk-node"]
---
**Alerta existe para acordar alguém.** Se ninguém precisa agir agora, é painel
ou relatório — e chamar isso de alerta é o que produz a fadiga que faz o alerta
de verdade ser ignorado.

## Alerte no sintoma, não na causa

CPU alta não é problema: é problema quando o usuário sente. Alerta sobre "o
serviço está entregando o que promete" sobrevive a mudança de arquitetura;
alerta sobre uso de recurso vira ruído no dia em que a máquina troca de tamanho.

A causa entra no **painel**, para diagnosticar depois que o sintoma acordou
alguém.

## SLO é um número que alguém aceitou

- O indicador mede o que o usuário percebe: proporção de requisições
  bem-sucedidas e rápidas o bastante — com "rápido o bastante" escrito em
  milissegundos.
- Meta em 100% não existe: obriga a parar de mudar o sistema. O orçamento de
  erro é a diferença entre a meta e 100%, e é ele que autoriza risco.
- Orçamento de erro é decisão de produto, não de infraestrutura. Gasto o
  orçamento, a conversa é sobre parar de lançar — e essa conversa precisa ter
  sido combinada antes de acontecer.

## Alerta que funciona

- Baseado em **queima de orçamento**, não em limiar instantâneo. Limiar
  instantâneo dispara em pico de um minuto que se resolve sozinho.
- Duas janelas: uma curta e rápida para queda aguda, uma longa e lenta para
  degradação persistente.
- Todo alerta aponta o que fazer. Alerta sem próximo passo transfere o problema
  de diagnóstico inteiro para quem foi acordado.
- Alerta que dispara e é fechado sem ação, repetidamente, é alerta a ser
  removido. Manter é treinar a equipe a ignorar.

## Percentil, e por quanto tempo

Média esconde a cauda. p95 e p99 mostram quem está sofrendo, e são eles que
entram no indicador. Um p50 saudável com p99 péssimo é um serviço bom para a
maioria e inutilizável para uma minoria constante — que costuma ser a mesma
minoria toda vez.

## Cardinalidade

Rótulo com identificador de usuário, de requisição ou de caminho não normalizado
multiplica séries até derrubar o coletor. Essa dimensão pertence a log e a
traço.

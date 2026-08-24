---
id: backend-observability
papeis: [implementador, avaliador, reparador]
arquivos: ["**/services/**", "**/handlers/**", "**/middleware/**", "**/api/**", "**/routes/**", "**/logger*", "**/telemetry*", "**/tracing*"]
deps: ["pino", "winston", "@opentelemetry/api", "@opentelemetry/sdk-node", "prom-client", "@sentry/node"]
---
**O que não sai do processo não existe durante o incidente.** Instrumentação é
escrita junto com o código, não depois — depois vira arqueologia com deploy no
meio.

## Log é estruturado, e o campo que salva é o identificador da requisição

- Um evento por linha, em JSON, com nível, instante, mensagem e contexto em
  campos — não interpolado no texto. Log interpolado não se filtra nem se
  agrupa.
- **Identificador de correlação atravessa todo o caminho**, inclusive as
  chamadas para outros serviços. Sem ele, três serviços produzem três histórias
  que ninguém junta.
- Nível é decisão, não hábito: `error` é o que acorda alguém, `warn` é o que
  degradou sem parar, `info` é transição de estado do negócio. Log de depuração
  em `info` some no volume e leva o resto junto.
- Nunca registre segredo, token, senha ou dado pessoal. Log vaza para mais
  destinos que o banco, e apagar depois raramente alcança todas as cópias.

## Métrica responde "está ruim?"; traço responde "onde?"

- As quatro que quase todo serviço precisa: taxa de requisição, taxa de erro,
  latência em percentil e saturação do recurso mais escasso.
- **Percentil, nunca média.** A média esconde a cauda, e a cauda é onde está o
  usuário que reclama. p95 e p99 dizem o que p50 não diz.
- Cardinalidade mata sistema de métrica: identificador de usuário ou de
  requisição como rótulo multiplica séries até derrubar o coletor. Isso é
  dimensão de log ou de traço, nunca de métrica.

## Erro que ninguém vê

- `catch` que só registra e segue precisa dizer por que seguir é correto. Sem
  isso, a falha vira comportamento estranho três camadas acima.
- A mensagem de erro nomeia o que falhou e o que fazer. "Erro ao processar" não
  distingue banco fora do ar de campo inválido.
- Propague a causa original ao embrulhar a exceção. Perder a causa transforma
  diagnóstico de minutos em tarde inteira.

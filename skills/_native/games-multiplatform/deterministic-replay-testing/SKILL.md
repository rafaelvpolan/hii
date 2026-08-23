---
id: deterministic-replay-testing
papeis: [implementador, avaliador]
arquivos: ["**/*.uproject", "**/project.godot", "**/*.csproj", "**/Assets/**"]
---
Teste de gameplay por screenshot é flaky por natureza: sombra, fonte e timing
mudam o pixel sem mudar o comportamento.

- Grave **entrada** (sequência de input com timestamp de passo fixo), não saída.
  Reproduza e compare o estado final do simulador.
- Passo fixo obrigatório: física dependente de framerate não é reproduzível, e
  então nada aqui funciona.
- Semente de random explícita e registrada no replay.
- O que o teste afirma é estado de jogo (posição, vida, pontuação), não frame.

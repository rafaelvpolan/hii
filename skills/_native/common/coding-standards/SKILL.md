---
id: coding-standards
papeis: [implementador, reparador, avaliador]
sempre: true
---
- Nome diz o que a coisa É, não como foi feita. `cardsPorDiretorio`, não `memo2`.
- Uma função faz uma coisa. Se o nome precisa de "e" no meio, são duas.
- Erro nunca é silenciado: `catch` vazio, fallback que esconde falha e valor
  padrão que mascara ausência são defeito, não robustez. Falhar visível é melhor
  que passar errado.
- Guarda que pode não guardar nada é pior que guarda nenhuma. Varredura, filtro
  ou laço que aprova quando não encontra nada precisa de asserção de que
  encontrou algo.
- Comentário explica o **porquê** de uma decisão não óbvia. Comentário que narra
  o que a linha faz sai.

---
id: api-design
papeis: [implementador, avaliador]
arquivos: ["**/routes/**", "**/api/**", "**/controllers/**", "**/*Controller.*", "**/handlers/**"]
---
- Erro tem formato único e estável: código legível por máquina, mensagem legível
  por humano, e um campo que identifica a requisição. Nunca devolva stack.
- Paginação por cursor onde a lista cresce; offset só onde o total é pequeno e
  estável.
- Versione o contrato antes de precisar. Remover campo é breaking; adicionar
  opcional não é.
- Validação na borda, uma vez, e o tipo interno já nasce confiável. Revalidar
  em camada de baixo esconde de quem é a responsabilidade.
- Idempotência em toda operação que o cliente pode reenviar: chave vinda do
  cliente, resultado gravado **antes** de a operação ser dada por concluída.

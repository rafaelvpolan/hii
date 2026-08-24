---
id: ci-pipeline
papeis: [empacotador, implementador, avaliador]
arquivos: ["**/.github/workflows/**", "**/.gitlab-ci.yml", "**/Jenkinsfile", "**/azure-pipelines.yml", "**/.circleci/**", "**/turbo.json", "**/nx.json"]
---
**Pipeline verde precisa significar alguma coisa.** Pipeline que verifica o que
é fácil de verificar dá a mesma cor de um que verifica o que quebra em
produção — e a diferença só aparece no incidente.

## O que o pipeline tem de exercitar

O caminho de produção, não só o caminho de teste. Se o artefato roda com um
runtime e a suíte roda com outro, o pipeline aprova algo que ninguém executou.
Suíte verde num runtime não é evidência sobre o outro.

Da mesma forma: `build` com sucesso prova que o artefato **é construído**, nunca
que ele **inicia**. Um passo que sobe o artefato e bate numa rota de saúde custa
segundos e cobre a classe inteira de falha de arranque.

## Rápido, ou vira algo que se espera terminar sem olhar

- Ordene por custo crescente: formatação e tipo antes de teste, teste antes de
  build de imagem.
- Cache de dependência com chave derivada do lockfile. Chave frouxa devolve
  cache velho; chave sem lockfile nunca acerta.
- Paralelize por eixo independente. Matriz que multiplica tudo por tudo gasta
  minuto em combinação que ninguém usa.
- Passo que falha sozinho e não é olhado é passo que deveria ser removido ou
  consertado. Vermelho tolerado ensina a ignorar vermelho.

## Determinismo

- Instalação usa o lockfile, em modo que **falha** se o lockfile divergir do
  manifesto. Resolver dependência no CI faz o build de hoje diferir do de ontem
  sem nenhuma mudança no código.
- Versão de ferramenta e de imagem base fixada. `latest` transforma build
  reproduzível em build datado.
- Nada de rede no meio do teste unitário: dependência externa faz o pipeline
  falhar por motivo que não é o código.

## Segredo

- Segredo vem do cofre do CI, nunca do repositório nem do log. Eco de variável
  em passo de depuração publica a credencial no histórico da execução.
- Execução vinda de fork não recebe segredo. Esse é o vetor clássico de
  exfiltração em projeto aberto.
- Ação e imagem de terceiro fixadas por hash, não por tag móvel: tag pode ser
  reapontada depois da revisão.

---
id: container-image
papeis: [empacotador, seguranca, avaliador]
arquivos: ["**/Dockerfile*", "**/Containerfile", "**/.dockerignore", "**/docker-stack.yml", "**/*.compose.y*ml"]
---
**A imagem é o contrato entre o que foi testado e o que roda.** Tudo que ela
carrega a mais é superfície de ataque e minuto de download em cada réplica.

## Camadas e tamanho

- Multi-estágio: o estágio que compila fica para trás, o final leva só o
  artefato. Toolchain na imagem final é peso e é ferramenta na mão de quem
  invadir.
- Copie o manifesto e o lockfile, instale, e **só então** copie o código. Na
  ordem inversa, qualquer mudança de código invalida o cache da instalação.
- `.dockerignore` antes de `COPY .`, senão `node_modules` local, `.git` e chave
  de desenvolvimento entram na imagem.
- Base fixada por versão, e de preferência por digest. `latest` faz duas
  construções do mesmo commit produzirem imagens diferentes.

## Segredo não entra em camada

Camada é imutável e distribuída: segredo em `ARG` ou em `COPY` continua
recuperável mesmo depois de removido num passo seguinte. Segredo entra em tempo
de execução — variável de ambiente, arquivo montado — ou por montagem de segredo
do próprio construtor.

## Execução

- Usuário sem privilégio, declarado no `USER`. Padrão é raiz, e raiz no
  contêiner é raiz no host em várias configurações.
- Sistema de arquivos somente leitura onde der, com volume só no que precisa
  escrever.
- Um processo por contêiner, e ele responde a `SIGTERM`. Processo iniciado por
  script de shell sem `exec` não recebe o sinal e é morto no prazo, no meio do
  trabalho.
- `HEALTHCHECK` que consulta o que o serviço precisa para servir.

## Configuração vem do ambiente

Imagem igual em todo ambiente; o que muda é o ambiente. Imagem por ambiente
significa que o que foi testado em homologação não é o que subiu em produção.

## Teto de recurso é do orquestrador, e precisa ser honrado

Declare limite de CPU e memória — e confirme que a plataforma escolhida
**respeita** a declaração. Teto que a plataforma ignora é pior que teto nenhum,
porque parece que existe. Processo dentro do contêiner não se autolimita: sem o
teto de fora, um laço preso consome o nó inteiro.

# Uma imagem, o mesmo comportamento em VPS, AWS, Azure e GCP.
# Regra do item 28: ZERO SDK de nuvem aqui e no motor. O hii fala HTTP com as
# APIs das IAs, git com o remoto e nada mais — o que e portavel por definicao.
FROM node:24-slim

# git e obrigatorio: o motor trabalha em worktree, nao em clone.
# gh e obrigatorio: e por ele que o PR abre e que o merge e detectado.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# pnpm e npm vem pelo corepack. bun entra opcional: com --build-arg COM_BUN=1 a
# imagem ganha os dois runtimes, e HICODE_RUNTIME escolhe qual executa.
RUN corepack enable
ARG COM_BUN=0
RUN if [ "$COM_BUN" = "1" ]; then npm install -g bun; fi

WORKDIR /app
COPY package.json bun.lock ./
# O package.json nao tem dependencia de runtime alguma — so devDependencies, e
# nenhuma delas e necessaria para executar um card. node_modules ficar vazio aqui
# e o desenho, nao esquecimento.
RUN npm install --omit=dev --no-audit --no-fund
COPY . .

# 12-factor: TODA configuracao vem do ambiente. O estado vive em volume externo
# ao container — perder o container nao pode perder card nem diario.
ENV HICODE_RUNTIME=node \
    HICODE_CARDS_DIR=/estado/cards \
    HICODE_REPOS_FILE=/estado/repos.json \
    HICODE_RUNNER_PIDFILE=/estado/runner.pid \
    HICODE_RUNNER_LOCK=/estado/runner.lock \
    HICODE_HEALTH_PORT=8080 \
    HICODE_HEALTH_HOST=0.0.0.0
VOLUME ["/estado"]
EXPOSE 8080

# O harness de IA NAO vem embutido, e isso e principio e nao lacuna: o item 1 diz
# que o motor e plugavel a qualquer IA, e embutir a versao de um CLI especifico
# amarraria a imagem justamente ao que ela nao deve amarrar. Monte o CLI e a
# credencial, ou instale num estagio derivado desta imagem.
# `hii doctor` diz exatamente o que falta antes de qualquer card rodar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "bin/hii.ts"]
CMD ["run"]

# Uma imagem, o mesmo comportamento em VPS, AWS, Azure e GCP.
# Regra do item 28: ZERO SDK de nuvem aqui e no motor. O hii fala HTTP com as
# APIs das IAs, git com o remoto e nada mais — o que e portavel por definicao.
FROM node:24-slim

# git e obrigatorio: o motor trabalha em worktree, nao em clone.
# gh e obrigatorio: e por ele que o PR abre e que o merge e detectado.
# psmisc (fuser) e obrigatorio: freePort (motor/ciclo/crivo/url-viva.ts) recupera a
# porta de preview com `fuser -k` e ENGOLE o erro por desenho — sem o binario, a
# recuperacao vira no-op silencioso e a porta de um dev-server orfao fica ocupada
# para sempre.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git psmisc \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# R: de 09/09 — "deixar tudo bun, menos execucoes proprias de outros projetos".
# O MOTOR roda sob bun (arranque ~5x mais rapido, e o runtime do desenvolvimento
# vira o de producao — a mesma coisa nos dois lugares). O node fica na imagem
# porque os REPOS-ALVO sao de quem os escreveu: contrato detectado com node/npm/
# pnpm roda com node/npm/pnpm, e o corepack serve os dois gerentes.
# O bun e pinado pelo MESMO .bun-version que o CI usa — versao divergente entre
# CI e producao foi exatamente o furo que o pin existiu para fechar.
RUN corepack enable
COPY .bun-version ./
RUN npm install -g "bun@$(cat .bun-version)"

WORKDIR /app
COPY package.json bun.lock ./
# O package.json nao tem dependencia de runtime alguma — so devDependencies, e
# nenhuma delas e necessaria para executar um card. node_modules ficar vazio aqui
# e o desenho, nao esquecimento. `bun install` porque o lockfile e bun.lock:
# copiar o lock e instalar com npm (que o ignora) era a incoerencia registrada
# em PENDENCIAS desde 29/08.
RUN bun install --frozen-lockfile --production
# A inspecao visual da URL (scripts/inspect-preview.mjs) e OPCIONAL na imagem:
# playwright e devDependency e, sem este estagio, o veredito em producao era
# SEMPRE "inconclusivo" por construcao (3/3 cards no runner.log) — o humano
# virava o unico detector de pagina quebrada. --build-arg COM_PREVIEW=1 instala
# o playwright pinado na mesma versao do package.json + chromium com deps.
ARG COM_PREVIEW=0
RUN if [ "$COM_PREVIEW" = "1" ]; then npm install --no-save playwright@1.62.1 \
 && npx playwright install --with-deps chromium; fi
COPY . .

# 12-factor: TODA configuracao vem do ambiente. O estado vive em volume externo
# ao container — perder o container nao pode perder card nem diario.
ENV HII_RUNTIME=bun \
    HII_CARDS_DIR=/estado/cards \
    HII_REPOS_FILE=/estado/repos.json \
    HII_RUNNER_PIDFILE=/estado/runner.pid \
    HII_RUNNER_LOCK=/estado/runner.lock \
    HII_HEALTH_PORT=8080 \
    HII_HEALTH_BIND=0.0.0.0
VOLUME ["/estado"]
EXPOSE 8080

# O harness de IA NAO vem embutido, e isso e principio e nao lacuna: o item 1 diz
# que o motor e plugavel a qualquer IA, e embutir a versao de um CLI especifico
# amarraria a imagem justamente ao que ela nao deve amarrar. Monte o CLI e a
# credencial, ou instale num estagio derivado desta imagem.
# `hii doctor` diz exatamente o que falta antes de qualquer card rodar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["bun", "bin/hii.ts"]
CMD ["run"]

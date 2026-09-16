# Validacao da externalizacao — issue 54

Ambiente: WSL Ubuntu, Node 24.17.0, Bun 1.4.0. Worktrees isolados;
nenhuma chamada de IA paga, merge, `bun link` ou reinicio do motor instalado.
Processos de teste usam fixtures, portas efemeras e diretorios temporarios.

## Entregas e limites

- HII: contrato de atividades v1, instrumentacao, persistencia/snapshot/SSE,
  cliente, ask readonly, configuracao, revisoes de plano, perguntas identificadas,
  artefatos textuais e historico. TUI e visualizador existente usam os mesmos dados.
- Hicode: `/motor` e backend HTTP/SSE autenticado, em issue/PR separados.
  Nao migra automaticamente as paginas legadas. O bearer fica no servidor.
- Consumidor independente: `examples/observador.ts`, streaming ou `--poll`.
  Outros adapters de IDE/task manager estao documentados, nao implementados.
- Cobertura interna de CLIs e parcial. Artefatos desta entrega sao evidencias
  textuais limitadas, nao upload generico de binarios/diffs/capturas. Administracao
  do host e operacoes locais restantes estao na matriz de paridade.

## Verificacao reproduzivel

Na raiz HII:

```bash
bun run typecheck
bun run lint:types
bun run lint:clone
HII_TEST_JOBS=1 bun run test:unit
bun run test:node
bun run test:tui:e2e
node scripts/validar-visualizador.mjs
node scripts/medir-observabilidade.mjs
```

Os 16 testes da extensao rodam em Bun e Node: escopo, terminal imutavel,
SSE anterior ao fim, dispose, recuperacao, processo orfao, falha de telemetria,
ask idempotente, conflitos de configuracao/plano/pergunta, segredo na borda do
log, artefatos com integridade/symlink e cache invalidado por escrita externa.
Os 21 testes HTTP legados continuam passando.

As suites completas passaram numa rodada anterior (Bun: 3.207; Node: 3.202).
A repeticao apos a otimizacao e os dois testes adicionais teve uma falha por
runtime em `test/mirante/tui-motor-integrado.test.ts`: Bun na tela CONFIRM
(3.208 aprovados), Node na mensagem final depois do fallback (3.172 aprovados
na primeira etapa). O arquivo passou novamente isolado no Bun; no Node, a
reverificacao serial dele junto dos quatro arquivos sensiveis a carga passou
nos 41 testes. A ultima rodada integral nao deve ser anunciada como verde; asserts e timeouts nao foram
relaxados para ocultar essas falhas intermitentes.

E2E TUI: PTY 48x36/100x36, replay 390/1365, reconexao/reinicio em fixture,
sem duplicacao. Visualizador: abas, filtro, importacao de snapshot e XSS nas
duas larguras. Hicode: Playwright 1365/390 com API real e harness simulado,
login, HTTP/SSE, hierarquia, metrica desconhecida, XSS, ask e token server-side;
161 testes unitarios passaram, um skip preexistente, em 21 arquivos isolados.
O isolamento evita que variaveis de ambiente e cache de modulos de um teste
apontem para diretorios temporarios removidos pelo teste anterior.

No Hicode, execute `bun run test` e
`HII_TEST_CHECKOUT=/caminho/checkout-hii node scripts/test-hii-observabilidade.mjs`.
As imagens de verificacao sao geradas em `/tmp/hicode-54-visual/`.

## Correcao das esperas E2E

A verificacao local posterior encontrou duas corridas no teste de navegador:
o echo do pedido podia aparecer antes de sua execucao ser persistida, e a
borda existente podia satisfazer a espera de resize antes do redesenho novo.
O teste agora espera o ID persistido da segunda execucao e reconhece no parser
do xterm os delimitadores HIDE/SHOW e HOME emitidos por `openScreen`. A espera
de resize exige um novo quadro completo; capturas aguardam o fim da pintura
e a renderizacao do navegador. CSI fragmentado pelo PTY continua reconhecido.
Baselines e tolerancia de pixels permanecem iguais, incluindo a verificacao
negativa que introduz um corte visual e exige sua rejeicao.
Validacao apos a correcao: tres rodadas completas de `test:tui:e2e` aprovadas,
incluindo relatorio de falhas, replay portavel e fixtures de reinicio/reconexao;
typecheck e lints aprovados. Evidencias locais: `/tmp/hii-54-sync-fix/`.

## Overhead

Limites fixados antes da medicao: p95 <100 ms e arquivo <16 MiB em 2.100
transicoes de 128 caracteres. Resultado final local: **p95 50,46 ms**,
**2.916.155 bytes**, recuperacao apos expiracao do cursor confirmada.
Uma medicao anterior atingiu 102,93 ms e reprovou: a escrita foi otimizada
para reutilizar o ultimo diario somente se a identidade do arquivo ainda
coincidir sob lock. O limite nao foi aumentado. Leituras continuam atomicas
do disco; substituicao por outro processo invalida a reutilizacao.

Estes numeros medem a fixture local, nao uma garantia de latencia em producao.
A instrumentacao pode ser desligada com `HII_OBSERVABILIDADE=0` no proximo
processo; nao se altera o journal de efeitos para recuperar telemetria.

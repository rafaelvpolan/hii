# Execução generativa com IA local (Ollama)

Mapa do que dá para delegar a modelos locais gratuitos (Ollama) neste repositório,
com o que já foi executado e o que é recomendação. Regra-mestra, alinhada ao
`config/model-tier.json` e ao desenho do runner ("não julga e não faz merge"):

> **O modelo local propõe; o gate determinístico (`bun run test`) dispõe.**
> Ollama nunca decide merge, nunca é o crivo, nunca cobre segurança/arquitetura
> (tier1). O valor dele é volume de rascunho a custo zero, não veredito.

## Ferramentas criadas nesta branch

| Script | O que faz | IA? |
|---|---|---|
| `scripts/generativo/ollama.mjs` | Wrapper zero-dep para `/api/generate`; loga toda chamada em `generativo/runs/chamadas.jsonl` com tokens medidos | chama |
| `scripts/generativo/mapa-cobertura.mjs` | Varre `motor/**/*.ts` × imports em `test/**/*.ts`; lista arquivos sem teste direto, por domínio | não |
| `scripts/generativo/receitas-stats.mjs` | Estatísticas de `receipts/receipts.jsonl` (volume, assinatura, por dia) | não |

O padrão deliberado: **tudo que é contável vira script determinístico**; a IA só
entra no resíduo que exige julgamento (classificar lacunas, inventar cenários).
Isso é o que "scripts que eliminam parte do trabalho da IA" significa na prática —
cada linha determinística é uma linha que nenhum modelo precisa acertar.

## O que já rodou

- **Mapa de cobertura determinístico** (corrigido no 5º ciclo): 228 arquivos em
  `motor/`, **210 exercitados, 18 sem teste** (a primeira versão dizia 88 —
  falso positivo de import dinâmico e barrel, ver 5º ciclo). JSON em
  `generativo/runs/cobertura-*.json`. Fila A por consenso: `tesouro/custo.ts`,
  `alfandega/confianca.ts`, `cartorio/responder-pergunta.ts`.
- **Testes novos nascidos do pipeline**: 8 casos de borda em
  `test/cordel/frontmatter.test.ts`, com 4 expectativas do rascunho generativo
  corrigidas na revisão.
- **Triagem das lacunas pelo Ollama** (2 modelos, vários ciclos): classificação
  A (teste unitário) / B (fio condutor) / C (fronteira de IO) em
  `generativo/runs/triagem-cobertura-*.md` — saída para revisão humana, não
  verdade. Divergências em `divergencias-triagem-*.md`.
- **Casos de borda gerados** para `politica.ts`, `tentativas.ts`, `cota.ts` e
  `frontmatter.ts` em `generativo/runs/casos-*.md` — `politica.ts` e
  `tentativas.ts` se mostraram já cobertos quando o mapa foi corrigido.
- **Receitas**: `receipts.jsonl` hoje tem 4014 linhas, **todas sem assinatura e
  com `tool` vazio** — não há sinal para a IA analisar. A recomendação real nesta
  frente é primeiro enriquecer o recibo (tool, custo, desfecho), só depois
  generar análise. IA em cima de dado vazio produz prosa, não diagnóstico.

## Hardware desta máquina e escolha de modelo

RTX 3060 Ti (8 GB VRAM), 16 cores, **7 GB RAM**. Consequência medida:

- `qwen3-coder:30b` (18,5 GB) **não cabe**: roda 68% CPU / 32% GPU com swap e não
  completou uma classificação de 88 linhas em 18+ minutos. Não usar aqui.
- `qwen2.5-coder:7b` cabe na GPU: mesma triagem em **60 s** (1198 tok entrada /
  2281 saída), casos de borda em **15 s**. É o modelo de trabalho local.
- `qwen3:8b` (5,2 GB) também instalado: mesma triagem em 108 s, aderência de
  formato igual (88/88 linhas válidas).
- `llama3`/`gemma` (8-9B, já instalados) servem para classificação e resumo curto.

## Aprendizados do 2º ciclo (observando a execução)

1. **Nenhum dos dois modelos sabe contar o próprio output.** Ambos erraram a
   linha RESUMO da triagem (qwen2.5 disse A=57/B=10/C=4, o real era A=51/B=23/C=14).
   Ajuste aplicado: prompts não pedem mais placar — a contagem é feita com
   `awk`/`grep` em cima das linhas. Regra geral: **nunca delegar aritmética ao
   modelo; o determinístico conta, o generativo classifica**.
2. **Dois modelos 7-8B divergem em metade das classificações** (46 concordam,
   43 divergem; ex.: `gauntlet.ts` A num e B no outro). Conclusão processal:
   um modelo só não classifica — o padrão útil é **concordância entre modelos
   vira priorização automática; divergência vai para o humano**.
3. **Formato rígido no prompt funciona** (3 linhas obrigatórias por cenário
   recuperou a aderência em `cota.ts`), mas **qualidade de julgamento varia por
   tipo de módulo**: CRUD/arquivo (`tentativas.ts`) saiu cenário útil citando
   funções reais; lógica temporal/de cota (`cota.ts`) virou fuzzing numérico
   superficial com comportamento esperado vago. Cenário para lógica temporal
   continua sendo trabalho de tier1/humano.

## Aprendizados do 3º ciclo (prompts corrigidos, rerodado)

1. **A regra anti-invenção funciona e é verificável.** Com "todo número precisa
   vir de constante do código", os cenários de `politica.ts` citaram
   `BACKOFF_STEPS_MS` com os valores reais (`30_000`…`600_000`) e o clamp
   `Math.min(Math.max(attempt,1), length)-1` — conferido contra
   `motor/ciclo/reprise/politica.ts:25-29`, bate. No 1º ciclo o mesmo modelo
   tinha inventado esses números.
2. **"Pense internamente, não responda" não funciona** — os dois modelos
   despejaram o PASSO 1 na saída. E isso é bom: o raciocínio visível é
   revisável. Ajuste de padrão: não pedir raciocínio escondido; cadeia visível
   = auditável.
3. **O mesmo modelo varia entre runs.** Prompt quase idêntico: o coder moveu
   C de 14→3 arquivos; o qwen3 caiu de 88→77 linhas válidas e mudou o placar
   inteiro. Classificação generativa precisa de N runs ou de lista de
   divergência como produto — nunca de uma run única como verdade.
4. **Consenso entre modelos caiu (27/73) e isso não é regressão do processo** —
   é a medida honesta de que classificação A/B/C por modelo pequeno é instável.
   A espinha continua sendo: mapa determinístico + consenso automático +
   divergência para o humano (`generativo/runs/divergencias-triagem-*.md`).
5. `cota.ts` melhorou (de fuzzing numérico para um cenário por ramo de função),
   mas vários cenários ficaram tautológicos ("qualquer valor → atualiza o
   objeto"). Teto do 7B em lógica temporal/de janela confirmado.

## 4º ciclo (rerodadas corrigidas)

- **qwen3:8b** rerodado com o mesmo prompt: voltou a 88/88 linhas válidas —
  o deslize de formato do ciclo anterior era variância de run, não do prompt.
  Placar mudou de novo (31/39/18), confirmando a instabilidade entre runs.
- **cota.ts** com regra anti-tautologia ("PROIBIDO 'qualquer valor'"): 11
  cenários, zero tautologias, estados concretos citando `PROVEDOR_DESCONHECIDO`
  e funções reais. A correção de prompt segurou.
- **Concordância final estável em ~50%** (44/44 de 88). Meio a meio é o número
  honesto para consenso entre dois 7-8B; a fila de revisão humana é a outra
  metade. Artefato atualizado em `divergencias-triagem-*.md`.

## 5º ciclo (o mapa é que estava errado; pipeline ponta a ponta)

1. **O falso positivo estava na heurística, não no modelo.** Dos 88 "sem
   teste", a maioria era import dinâmico (`await import`, 137 arquivos da
   suíte) e barrel (`motor/cordel/index.ts` re-exportando). Corrigido no
   `mapa-cobertura.mjs`: 88 → 22 → **18 arquivos realmente sem teste**
   (210/228 exercitados). Lição: audite o instrumento antes de agir sobre a
   medida — os 4 primeiros ciclos triavam uma lista meio falsa.
2. **Pipeline completo demonstrado em `frontmatter.ts`**: mapa → triagem
   (consenso A) → cenários gerados → **revisão achou 4 expectativas erradas
   em 10** (ordem alfabética inventada, fm vazio, linha em branco omitida) →
   8 testes novos escritos com o comportamento verificado no código, em
   `test/cordel/frontmatter.test.ts`. O funil segurou: nada do rascunho entrou
   sem verificação.
3. **Prompt exigindo caminho completo cura o deslize de prefixo** (o coder
   tinha respondido só basenames): 18/18 linhas válidas nos dois modelos.
4. Consenso A final, fila real de trabalho: `tesouro/custo.ts`,
   `alfandega/confianca.ts`, `cartorio/responder-pergunta.ts`.

## 6º ciclo (fila consenso-A vira teste)

- **`tesouro/custo.ts` e `alfandega/confianca.ts` testados** (9 testes novos,
  gate 2740 verde). Revisão dos rascunhos: 2/8 expectativas erradas em
  `custo.ts` (o modelo achou que negativo era desconhecido e que decimal
  truncava — o código passa ambos intactos); em `confianca.ts` o "motivo
  vazio" é irrepresentável (`RefusalReason` é união fechada — o typecheck é a
  proteção, não o runtime).
- **`cartorio/responder-pergunta.ts` fica para um card próprio**: a superfície
  testável é o prompt montado e o mapeamento do resultado, mas
  `runProvider` chama um provedor de verdade — teste honesto pede a
  infraestrutura de cassete (`test/tomada/cassete.test.ts`), não mock
  improvisado. Consenso A do modelo não muda essa realidade.
- **Lição de processo: rodar o gate cedo.** O runtime perdoou `Refusal` sem
  `ok: false` (9/9 verdes no `node --test`), o `tsc --noEmit` barrou. O gate
  completo é a única barra que vale.

## Frentes e onde cada uma encaixa

1. **Geração de testes (tier2, "escopo definido pela matriz")** — viável.
   Ollama gera *cenários* (listas de caso de borda), não suítes prontas: cenário
   é barato de revisar; código de teste gerado inteiro esconde erro sutil.
   O teste que nasce disso entra pelo fluxo normal e é preso pelos invariantes
   existentes (`test/mapa-de-testes.test.ts`, `isolamento-de-testes`).
2. **Auditoria de cobertura** — viável e já iniciada. O mapa é determinístico;
   a IA só tria a lista de lacunas. Rodar o mapa no CI ou por card é barato e
   alimenta o `PENDENCIAS.md` com evidência em vez de intuição.
3. **Análise de receipts/custo** — bloqueada por dado, não por modelo. Enriquecer
   o schema do recibo primeiro; depois disso um modelo 8B (llama3/gemma) já
   resume padrões de falha, e o qwen3-coder calibra o `orcamentoPorCard`.
4. **Pré-review local** — viável com escopo estreito: Ollama como *primeira
   leitura* do diff (aponta suspeitos, filtra ruído), crivo tier1 continua sendo
   a última leitura. Nunca inverter essa ordem — `model-tier.json` fixa review
   como tier1 pelo custo do falso negativo.
5. **Simulação de execução/tokens** — parcialmente viável. O wrapper já mede
   tokens locais; para simular custo de cards basta replay determinístico dos
   prompts gravados contra o Ollama. Simular *qualidade* do modelo pago com
   modelo local não é válido — não use para prever aprovação no crivo.
6. **Mapeamento de arquivos integrado ao motor** — o mapa de cobertura pode virar
   insumo do runner (ex.: card novo ganha anexo "arquivos de motor/ tocados sem
   teste direto"). Integração real é decisão de arquitetura → tier1, humano.
7. **Orquestradores, skills, agents generativos** — com trava: MODERNIZATION.md
   (:828) fixa que trigger de skill nunca sai do automático sem julgamento humano.
   Ollama pode *redigir* rascunhos de skill/agent/loadout; a importação e a
   ativação continuam atos humanos.
8. **Eficiência de harness/loops** — análise generativa em cima dos logs
   (`.runner.log`, `generativo/runs/chamadas.jsonl`) pode sugerir onde loops
   gastam tentativa à toa; mas instrumentação nova é código → fluxo normal.

## Limites honestos

- Modelos locais erram código com confiança — a triagem saiu com o placar-resumo
  errado e os casos de borda vieram com números inventados. Toda saída generativa
  desta branch é **rascunho para revisão**, nunca patch direto em `motor/`.
- Modelo que não cabe na VRAM/RAM é pior que modelo menor: o 30B local entrega
  menos por hora que o 7B. Escolha por throughput medido, não por tamanho nominal.
- "Rodar até chegar no melhor modelo" só faz sentido com critério objetivo de
  parada (ex.: % de cenários aprovados na revisão). Sem métrica, loop generativo
  é só gasto de GPU.

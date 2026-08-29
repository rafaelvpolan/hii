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

## O que já rodou (2026-08-29, qwen2.5-coder:7b)

- **Mapa de cobertura determinístico**: 228 arquivos em `motor/`, 140 com import
  direto em teste, 88 sem. Piores razões: `euclides` 6/23, `ciclo` 13/24,
  `quilombo` 10/23. JSON em `generativo/runs/cobertura-*.json`.
- **Triagem das 88 lacunas pelo Ollama**: classificação A (teste unitário) / B
  (fio condutor, coberto indireto) / C (fronteira de IO) em
  `generativo/runs/triagem-cobertura-*.md` — saída para revisão humana, não verdade
  (o RESUMO do modelo saiu com contagem errada; confira o corpo, não o placar).
- **Casos de borda gerados** para `motor/ciclo/reprise/politica.ts` em
  `generativo/runs/casos-politica-*.md` — candidatos a virar teste; atenção: o
  modelo afirmou números de backoff (30s/1min/2min/5min) que precisam ser
  conferidos contra o código antes de virar expectativa de teste.
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
- `qwen3:8b` (5,2 GB) também instalado — alternativa com mais raciocínio geral.
- `llama3`/`gemma` (8-9B, já instalados) servem para classificação e resumo curto.

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

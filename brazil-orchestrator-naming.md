# 🇧🇷 BRAZIL — Arquitetura de Nomes

> Taxonomia de nomes para a arquitetura do motor de orquestração multi-IA.
>
> **Princípio:** o nome brasileiro representa o comportamento arquitetural do componente — não apenas uma homenagem.
>
> **A abreviatura de três letras foi aposentada em 29/08/2026** — o nome por extenso é o que
> aparece em pasta, arquivo, comentário e documento. Commits anteriores a essa data usam o
> código curto.

---

## 1. Espinha dorsal

| Nome | Conceito | Papel no motor |
|---|---|---|
| **Oswaldo** | Oswaldo Cruz | Orquestrador principal |
| **Rota** | Rotas / exploração territorial | Router inteligente |
| **Niemeyer** | Oscar Niemeyer | Graph Engineering |
| **Ciclo** | Ciclos de execução | Agent Loop |
| **Crivo** | Filtro rigoroso | Hardness / Quality Gate |
| **Canudos** | Resistência sob pressão | Gauntlet Loop |

### Princípio operacional

```text
Oswaldo roteia.
Rota decide.
Niemeyer estrutura.
Ciclo executa.
Crivo julga.
Canudos pressiona.
```

---

## 2. Orquestração

### Oswaldo — Oswaldo

**Referência:** Oswaldo Cruz

**Papel:** Orchestrator

Coordena o sistema como um todo, distribuindo responsabilidades entre routers, graphs, loops e agentes.

```text
Intent
  ↓
Oswaldo
  ├── Rota → escolhe rota
  ├── Niemeyer → constrói graph
  ├── Ciclo → executa loop
  └── Crivo → valida resultado
```

---

### Rui — Rui

**Referência:** Rui Barbosa

**Papel:** Strategic Orchestrator / Strategy

Representa estratégia, argumentação, organização e tomada de decisão em nível superior.

Pode atuar como camada estratégica acima da execução.

---

### Rota — Rota

**Referência:** rotas, bandeiras e integração territorial brasileira

**Papel:** Intelligent Router

Decide **para onde** uma tarefa deve ir.

```text
Rota
├── Claude
├── GPT
├── Codex
├── Qwen
├── Kimi
├── DeepSeek
└── Local Models
```

Pergunta central:

> **Quem deve executar isso?**

---

## 3. Loops

### Ciclo — Ciclo

**Referência:** conceito de ciclos

**Papel:** Agent Loop

Loop fundamental de execução:

```text
PLAN
 ↓
ACT
 ↓
OBSERVE
 ↓
REFLECT
 ↓
ACT
 ↓
...
```

Responsável por permitir que um agente execute, observe o resultado, reflita e continue até atingir uma condição de saída.

---

### Crivo — Crivo

**Referência:** crivo como mecanismo de filtragem rigorosa

**Papel:** Hardness / Quality Gate

O Crivo não precisa executar a solução.

Ele **julga o resultado**.

```text
Agent
  ↓
Result
  ↓
Crivo
  ├── PASS → continue
  └── FAIL → CICLO novamente
```

Responsabilidades:

- validar qualidade;
- verificar critérios;
- rejeitar resultados insuficientes;
- impor invariantes;
- determinar se a execução pode avançar.

---

### Canudos — Canudos

**Referência:** Guerra de Canudos

**Papel:** Gauntlet Loop

Representa resistência, múltiplas investidas e sobrevivência sob pressão.

Um problema é submetido a várias rodadas de agentes, críticas e validações.

```text
Canudos
 │
 ├── Agent
 ├── Agent
 ├── Critic
 ├── Test
 ├── Security
 ├── Crivo
 └── Retry
```

A solução precisa **sobreviver ao gauntlet**.

---

## 4. Graph Engineering

### Niemeyer — Niemeyer

**Referência:** Oscar Niemeyer

**Papel:** Graph Engineering / Graph Runtime

Representa arquitetura, estrutura e composição.

```text
Niemeyer
├── Nodes
├── Edges
├── Conditions
├── Dependencies
├── Parallelism
└── Execution
```

Possíveis componentes:

```text
Niemeyer Graph
Niemeyer Node
Niemeyer Edge
Niemeyer Runtime
Niemeyer Planner
```

---

### Lúcio — Lúcio

**Referência:** Lúcio Costa

**Papel:** Graph Planning / Structural Planning

Responsável pela organização estrutural do graph antes da execução.

Pode trabalhar em conjunto com Niemeyer:

```text
Lúcio → planeja estrutura
Niemeyer → materializa / executa estrutura
```

---

## 5. Agents

### Rondon — Rondon

**Referência:** Marechal Rondon

**Papel:** Research Agent

Exploração, mapeamento, descoberta e investigação de território desconhecido.

```text
Rondon
├── Search
├── Explore
├── Collect
├── Correlate
└── Report
```

---

### Dumont — Dumont

**Referência:** Santos Dumont

**Papel:** Engineering / Code Agent

Representa invenção, engenharia, experimentação e construção.

```text
Requirement
  ↓
Dumont
  ↓
Implementation
  ↓
Tests
```

---

### Assis — Assis

**Referência:** Machado de Assis

**Papel:** Review / Critic Agent

Responsável por análise crítica e identificação de inconsistências.

```text
Assis
├── Review
├── Detect
├── Question
├── Challenge
└── Report
```

Pode analisar:

- bugs;
- abstrações ruins;
- inconsistências;
- duplicação;
- problemas arquiteturais;
- edge cases;
- violações de padrões.

---

### Senna — Senna

**Referência:** Ayrton Senna

**Papel:** Fast Agent / Fast Path

Representa velocidade combinada com precisão.

Indicado para:

- tarefas simples;
- baixa latência;
- respostas rápidas;
- classificação;
- pequenas transformações;
- decisões de baixo custo.

```text
Senna
↓
FAST PATH
```

---

### Drummond — Drummond

**Referência:** Carlos Drummond de Andrade

**Papel:** Deep Reasoning Agent

Representa profundidade e análise.

Indicado para:

- arquitetura;
- debugging complexo;
- planejamento;
- análise de sistemas;
- refactoring grande;
- problemas com múltiplas dependências.

```text
Drummond
↓
DEEP REASONING
```

---

### Tarsila — Tarsila

**Referência:** Tarsila do Amaral

**Papel:** Creative Agent

Criatividade, composição e exploração de alternativas.

Indicado para:

- UI;
- UX;
- design;
- naming;
- copy;
- ideação;
- alternativas de solução.

---

### Portinari — Portinari

**Referência:** Cândido Portinari

**Papel:** Vision Agent

Representação e interpretação visual.

Indicado para:

- análise de imagens;
- UI visual;
- screenshots;
- diagramas;
- design visual.

---

### Clarice — Clarice

**Referência:** Clarice Lispector

**Papel:** Language Agent

Interpretação, linguagem e expressão.

Indicado para:

- interpretação de requisitos;
- escrita;
- documentação;
- transformação textual;
- análise semântica.

---

### Cascudo — Cascudo

**Referência:** Câmara Cascudo

**Papel:** Knowledge Agent

Conhecimento, memória e organização de informação.

Indicado para:

- documentação;
- conhecimento de domínio;
- recuperação de contexto;
- síntese de conhecimento.

---

## 6. Integração e infraestrutura

### Ponte — Ponte

**Referência:** ponte como ligação entre sistemas

**Papel:** Integration / MCP Gateway

Conecta o motor a ferramentas, serviços e sistemas externos.

```text
Agent
  ↓
Ponte
  ├── MCP
  ├── APIs
  ├── Services
  ├── Databases
  └── External Tools
```

---

### Mapa — Mapa

**Referência:** cartografia e mapeamento

**Papel:** Tool Registry

Catálogo de ferramentas e capacidades disponíveis.

```text
Mapa
├── Tool
├── Capability
├── Provider
├── Schema
└── Permission
```

---

### Radar — Radar

**Referência:** radar

**Papel:** Telemetry / Observability

Monitora o comportamento do motor.

```text
Radar
├── Events
├── Metrics
├── Traces
├── Tokens
├── Latency
└── Errors
```

---

### Eco — Eco

**Referência:** eco

**Papel:** Cache / Reuse

Permite reutilização de informações e resultados já produzidos.

```text
Request
  ↓
Eco
  ├── HIT  → reuse
  └── MISS → execute
```

---

## 7. Coordenação

### Roda — Roda

**Referência:** roda de conversa

**Papel:** Consensus

Permite que múltiplos agentes apresentem posições e cheguem a uma decisão.

```text
Agent A ─┐
Agent B ─┼→ Roda → Consensus
Agent C ─┘
```

---

### Arena — Arena

**Referência:** arena

**Papel:** Debate

Coloca agentes ou soluções em confronto deliberado.

```text
Solution A ─┐
            ├── Arena → Winner / Synthesis
Solution B ─┘
```

---

### Voto — Voto

**Referência:** voto

**Papel:** Voting / Selection

Seleciona uma alternativa entre múltiplas propostas.

```text
A ─┐
B ─┼→ Voto → B
C ─┘
```

---

### Reprise — Reprise

**Referência:** repetição / nova tentativa

**Papel:** Retry

Executa novamente uma etapa após falha ou resultado insuficiente.

```text
FAIL
 ↓
Reprise
 ↓
RETRY
```

---

### Retirada — Retirada

**Referência:** retirada estratégica

**Papel:** Fallback

Abandona uma estratégia ou rota e tenta uma alternativa.

```text
Route A
  ↓
FAIL
  ↓
Retirada
  ↓
Route B
```

---

## 8. Taxonomia consolidada — nomes

| Nome | Papel |
|---|---|
| **Oswaldo** | Orchestrator |
| **Rui** | Strategic Orchestrator |
| **Rota** | Router |
| **Niemeyer** | Graph Engineering |
| **Lúcio** | Graph Planning |
| **Ciclo** | Agent Loop |
| **Crivo** | Hardness / Quality Gate |
| **Canudos** | Gauntlet Loop |
| **Rondon** | Research |
| **Dumont** | Engineering / Code |
| **Assis** | Review / Critic |
| **Senna** | Fast |
| **Drummond** | Deep Reasoning |
| **Tarsila** | Creative |
| **Portinari** | Vision |
| **Clarice** | Language |
| **Cascudo** | Knowledge |
| **Ponte** | Integration / MCP |
| **Mapa** | Tool Registry |
| **Radar** | Telemetry |
| **Eco** | Cache |
| **Roda** | Consensus |
| **Arena** | Debate |
| **Voto** | Voting |
| **Reprise** | Retry |
| **Retirada** | Fallback |

---

## 9. Arquitetura conceitual

```text
                         ┌─────────────┐
                         │     Oswaldo     │
                         │ ORCHESTRATOR│
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │     Rui     │
                         │  STRATEGY   │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │     Rota     │
                         │   ROUTER    │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
          ┌───▼───┐         ┌───▼───┐         ┌───▼───┐
          │  Niemeyer  │         │  Ciclo  │         │  Canudos  │
          │ GRAPH │         │ LOOP  │         │GAUNT. │
          └───┬───┘         └───┬───┘         └───┬───┘
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                         ┌──────▼──────┐
                         │    AGENTS   │
                         └──────┬──────┘
                                │
       ┌────────┬────────┬──────┼──────┬────────┬────────┐
       │        │        │      │      │        │        │
      Rondon      Dumont      Assis    Senna    Drummond      Tarsila      Portinari
    Research   Code    Review  Fast   Deep   Creative  Vision
       │        │        │      │      │        │        │
       └────────┴────────┴──────┼──────┴────────┴────────┘
                                │
                         ┌──────▼──────┐
                         │     Crivo     │
                         │   CRIVO     │
                         └──────┬──────┘
                                │
                         PASS / REJECT
                                │
                    ┌───────────┴───────────┐
                    │                       │
                   PASS                    FAIL
                    │                       │
                 OUTPUT                   Ciclo
                                            │
                                            └──→ retry
```

---

## 10. Regra de nomenclatura

### Princípio

> **Nome brasileiro = comportamento arquitetural.**

Não escolher um nome apenas porque a pessoa é famosa.

O nome deve carregar uma associação funcional.

Exemplos:

- **Dumont** → invenção / engenharia → Code Agent
- **Assis** → crítica / análise → Review Agent
- **Senna** → velocidade / precisão → Fast Agent
- **Rondon** → exploração / mapeamento → Research Agent
- **Niemeyer** → arquitetura / estrutura → Graph Engine
- **Crivo** → filtragem / rigor → Quality Gate
- **Canudos** → resistência / pressão → Gauntlet
- **Oswaldo** → coordenação / combate sistemático → Orchestrator

Assim, a cultura brasileira deixa de ser apenas estética e passa a funcionar como uma **linguagem semântica da arquitetura**.

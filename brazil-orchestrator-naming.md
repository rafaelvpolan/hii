# 🇧🇷 BRAZIL — Arquitetura de Nomes

> Taxonomia de nomes para a arquitetura do motor de orquestração multi-IA.
>
> **Princípio:** o nome brasileiro representa o comportamento arquitetural do componente — não apenas uma homenagem.

---

## 1. Espinha dorsal

| Código | Nome | Conceito | Papel no motor |
|---|---|---|---|
| **OSW** | **Oswaldo** | Oswaldo Cruz | Orquestrador principal |
| **RTA** | **Rota** | Rotas / exploração territorial | Router inteligente |
| **NMY** | **Niemeyer** | Oscar Niemeyer | Graph Engineering |
| **CIC** | **Ciclo** | Ciclos de execução | Agent Loop |
| **CRV** | **Crivo** | Filtro rigoroso | Hardness / Quality Gate |
| **CND** | **Canudos** | Resistência sob pressão | Gauntlet Loop |

### Princípio operacional

```text
OSW roteia.
RTA decide.
NMY estrutura.
CIC executa.
CRV julga.
CND pressiona.
```

---

## 2. Orquestração

### OSW — Oswaldo

**Referência:** Oswaldo Cruz

**Papel:** Orchestrator

Coordena o sistema como um todo, distribuindo responsabilidades entre routers, graphs, loops e agentes.

```text
Intent
  ↓
OSW
  ├── RTA → escolhe rota
  ├── NMY → constrói graph
  ├── CIC → executa loop
  └── CRV → valida resultado
```

---

### RUI — Rui

**Referência:** Rui Barbosa

**Papel:** Strategic Orchestrator / Strategy

Representa estratégia, argumentação, organização e tomada de decisão em nível superior.

Pode atuar como camada estratégica acima da execução.

---

### RTA — Rota

**Referência:** rotas, bandeiras e integração territorial brasileira

**Papel:** Intelligent Router

Decide **para onde** uma tarefa deve ir.

```text
RTA
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

### CIC — Ciclo

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

### CRV — Crivo

**Referência:** crivo como mecanismo de filtragem rigorosa

**Papel:** Hardness / Quality Gate

O Crivo não precisa executar a solução.

Ele **julga o resultado**.

```text
Agent
  ↓
Result
  ↓
CRV
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

### CND — Canudos

**Referência:** Guerra de Canudos

**Papel:** Gauntlet Loop

Representa resistência, múltiplas investidas e sobrevivência sob pressão.

Um problema é submetido a várias rodadas de agentes, críticas e validações.

```text
CND
 │
 ├── Agent
 ├── Agent
 ├── Critic
 ├── Test
 ├── Security
 ├── CRV
 └── Retry
```

A solução precisa **sobreviver ao gauntlet**.

---

## 4. Graph Engineering

### NMY — Niemeyer

**Referência:** Oscar Niemeyer

**Papel:** Graph Engineering / Graph Runtime

Representa arquitetura, estrutura e composição.

```text
NMY
├── Nodes
├── Edges
├── Conditions
├── Dependencies
├── Parallelism
└── Execution
```

Possíveis componentes:

```text
NMY Graph
NMY Node
NMY Edge
NMY Runtime
NMY Planner
```

---

### LUC — Lúcio

**Referência:** Lúcio Costa

**Papel:** Graph Planning / Structural Planning

Responsável pela organização estrutural do graph antes da execução.

Pode trabalhar em conjunto com NMY:

```text
LUC → planeja estrutura
NMY → materializa / executa estrutura
```

---

## 5. Agents

### RND — Rondon

**Referência:** Marechal Rondon

**Papel:** Research Agent

Exploração, mapeamento, descoberta e investigação de território desconhecido.

```text
RND
├── Search
├── Explore
├── Collect
├── Correlate
└── Report
```

---

### DUM — Dumont

**Referência:** Santos Dumont

**Papel:** Engineering / Code Agent

Representa invenção, engenharia, experimentação e construção.

```text
Requirement
  ↓
DUM
  ↓
Implementation
  ↓
Tests
```

---

### ASS — Assis

**Referência:** Machado de Assis

**Papel:** Review / Critic Agent

Responsável por análise crítica e identificação de inconsistências.

```text
ASS
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

### SEN — Senna

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
SEN
↓
FAST PATH
```

---

### DRM — Drummond

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
DRM
↓
DEEP REASONING
```

---

### TSL — Tarsila

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

### PRT — Portinari

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

### CLR — Clarice

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

### CSD — Cascudo

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

### PNT — Ponte

**Referência:** ponte como ligação entre sistemas

**Papel:** Integration / MCP Gateway

Conecta o motor a ferramentas, serviços e sistemas externos.

```text
Agent
  ↓
PNT
  ├── MCP
  ├── APIs
  ├── Services
  ├── Databases
  └── External Tools
```

---

### MAP — Mapa

**Referência:** cartografia e mapeamento

**Papel:** Tool Registry

Catálogo de ferramentas e capacidades disponíveis.

```text
MAP
├── Tool
├── Capability
├── Provider
├── Schema
└── Permission
```

---

### RDR — Radar

**Referência:** radar

**Papel:** Telemetry / Observability

Monitora o comportamento do motor.

```text
RDR
├── Events
├── Metrics
├── Traces
├── Tokens
├── Latency
└── Errors
```

---

### ECO — Eco

**Referência:** eco

**Papel:** Cache / Reuse

Permite reutilização de informações e resultados já produzidos.

```text
Request
  ↓
ECO
  ├── HIT  → reuse
  └── MISS → execute
```

---

## 7. Coordenação

### RDA — Roda

**Referência:** roda de conversa

**Papel:** Consensus

Permite que múltiplos agentes apresentem posições e cheguem a uma decisão.

```text
Agent A ─┐
Agent B ─┼→ RDA → Consensus
Agent C ─┘
```

---

### ARN — Arena

**Referência:** arena

**Papel:** Debate

Coloca agentes ou soluções em confronto deliberado.

```text
Solution A ─┐
            ├── ARN → Winner / Synthesis
Solution B ─┘
```

---

### VTO — Voto

**Referência:** voto

**Papel:** Voting / Selection

Seleciona uma alternativa entre múltiplas propostas.

```text
A ─┐
B ─┼→ VTO → B
C ─┘
```

---

### RPR — Reprise

**Referência:** repetição / nova tentativa

**Papel:** Retry

Executa novamente uma etapa após falha ou resultado insuficiente.

```text
FAIL
 ↓
RPR
 ↓
RETRY
```

---

### RTD — Retirada

**Referência:** retirada estratégica

**Papel:** Fallback

Abandona uma estratégia ou rota e tenta uma alternativa.

```text
Route A
  ↓
FAIL
  ↓
RTD
  ↓
Route B
```

---

## 8. Taxonomia consolidada

| Código | Nome | Papel |
|---|---|---|
| **OSW** | Oswaldo | Orchestrator |
| **RUI** | Rui | Strategic Orchestrator |
| **RTA** | Rota | Router |
| **NMY** | Niemeyer | Graph Engineering |
| **LUC** | Lúcio | Graph Planning |
| **CIC** | Ciclo | Agent Loop |
| **CRV** | Crivo | Hardness / Quality Gate |
| **CND** | Canudos | Gauntlet Loop |
| **RND** | Rondon | Research |
| **DUM** | Dumont | Engineering / Code |
| **ASS** | Assis | Review / Critic |
| **SEN** | Senna | Fast |
| **DRM** | Drummond | Deep Reasoning |
| **TSL** | Tarsila | Creative |
| **PRT** | Portinari | Vision |
| **CLR** | Clarice | Language |
| **CSD** | Cascudo | Knowledge |
| **PNT** | Ponte | Integration / MCP |
| **MAP** | Mapa | Tool Registry |
| **RDR** | Radar | Telemetry |
| **ECO** | Eco | Cache |
| **RDA** | Roda | Consensus |
| **ARN** | Arena | Debate |
| **VTO** | Voto | Voting |
| **RPR** | Reprise | Retry |
| **RTD** | Retirada | Fallback |

---

## 9. Arquitetura conceitual

```text
                         ┌─────────────┐
                         │     OSW     │
                         │ ORCHESTRATOR│
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │     RUI     │
                         │  STRATEGY   │
                         └──────┬──────┘
                                │
                         ┌──────▼──────┐
                         │     RTA     │
                         │   ROUTER    │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
          ┌───▼───┐         ┌───▼───┐         ┌───▼───┐
          │  NMY  │         │  CIC  │         │  CND  │
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
      RND      DUM      ASS    SEN    DRM      TSL      PRT
    Research   Code    Review  Fast   Deep   Creative  Vision
       │        │        │      │      │        │        │
       └────────┴────────┴──────┼──────┴────────┴────────┘
                                │
                         ┌──────▼──────┐
                         │     CRV     │
                         │   CRIVO     │
                         └──────┬──────┘
                                │
                         PASS / REJECT
                                │
                    ┌───────────┴───────────┐
                    │                       │
                   PASS                    FAIL
                    │                       │
                 OUTPUT                   CIC
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

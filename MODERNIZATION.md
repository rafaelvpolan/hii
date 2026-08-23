# hii — Plano Mestre de Arquitetura e Engenharia de IA

Documento único consolidando as seis rodadas de análise desta conversa: diagnóstico de arquitetura, comparativo com outros ecossistemas de agentes, catálogo de skills e cadeia de execução, modelo de pastas multi-origem, modernização/orquestração manual/pilares de entrega, e confiabilidade de produção multi-nuvem. Cada parte mantém a numeração interna original; referências cruzadas entre partes foram ajustadas para apontar pra cá dentro do mesmo arquivo.

## Sumário

- Parte I — Diagnóstico de Arquitetura
- Parte II — Comparativo com Outros Ecossistemas de Orquestração
- Parte III — Catálogo de Papéis, Skills e Cadeia de Execução
- Parte IV — Modelo de Pastas Multi-Origem
- Parte V — Skills Modernas, Orquestração Manual, Blocos, Governança e Pilares
- Parte VI — Confiabilidade de Produção e Multi-Nuvem
- Parte VII — Roadmap Consolidado (itens 1–32)

---

## Parte I — Diagnóstico de Arquitetura

Análise do estado atual do motor `hii` frente aos padrões de engenharia de agentes hoje reconhecidos como boas práticas (linha "Building Effective Agents" da Anthropic, dez/2024, e o desdobramento "Effective Context Engineering for AI Agents", 2025), com foco no que você pediu: **zero dependência de terceiros, plugável a qualquer IA configurada, autoresolutivo e com qualidade**.

Importante de cara: seu instinto de não adotar LangGraph/CrewAI/AutoGen está certo do ponto de vista da própria Anthropic. A recomendação oficial é começar pela solução mais simples possível e só aumentar complexidade quando um caso real exigir — frameworks genéricos tendem a atrapalhar mais do que ajudar quando o motor já tem estado próprio bem definido (cards, worktree, gates que fecham em disco). Isso não é um desvio das boas práticas, é a aplicação correta delas.

---

### 1. O que o hii já faz certo (mapeado aos padrões formais)

| Peça do hii | Padrão formal correspondente | Por que está certo |
|---|---|---|
| Pipeline de card (`INBOX → ... → PR_OPEN`) | *Prompt Chaining* com checkpoints determinísticos | Task decomponível em subtarefas fixas com validação entre etapas — exatamente o caso de uso recomendado para chaining, não para um agente livre |
| `analyze.ts` decidindo perfil (`completo/enxuto/deps/padrao/externo`) | *Routing* | Classificação determinística (zero token) decidindo o caminho — evita gastar um agente inteiro só para rotear |
| Passos de polimento (rufus/testudo/escudo/crivo/pura) | *Orchestrator-Workers* | Decomposição em especialistas com contexto focado por fase |
| Gate fechando por exit code em disco, nunca por "o modelo disse que passou" | *Evaluator determinístico* | Este é o ponto mais forte do seu motor. A literatura atual é explícita: não confiar no autorrelato do modelo para verificação objetiva é a diferença entre um gate real e teatro de qualidade |
| Retry de URL (`HICODE_URL_AJUSTES`, correção estreita, 1 tentativa) | Embrião de *Evaluator-Optimizer* / repair loop | Padrão certo: instrução estreita, não recomeço. Só está aplicado a um caso (subida do servidor) |
| Ledger por chamada de IA (papel, provedor, custo, tokens) | Instrumentação | "Instrument everything" é citado por toda a literatura de agentes em produção como pré-requisito — você já tem isso |
| Parede humana obrigatória no merge | *Human-in-the-loop* | Ação irreversível (merge) nunca é automática — correto e inegociável |
| `cwd-guard`, `acceptEdits`, denylist | Princípio de menor privilégio / minimal footprint | Confinamento do agente ao raio de ação necessário |
| Cota estourada para, sem troca automática de provedor | Previsibilidade de custo/qualidade | Troca silenciosa de modelo é exatamente o tipo de "esperteza" que a prática atual desaconselha sem consentimento explícito |

Isso é uma base bem mais madura do que a maioria dos orquestradores que existem hoje no mercado (a maioria só faz roteamento de chamada; poucos têm gate determinístico fechando em disco).

---

### 2. Lacunas reais frente ao estado da arte

**2.1 — Harness não é uma interface formal.**
Hoje "provedor" parece ser um switch centralizado (`runProvider`) que mistura autenticação, invocação e parsing. Isso funciona para 4 provedores, mas cada IA nova (Qwen Code, DeepSeek, Gemini CLI) vira uma mudança no core em vez de um plugin isolado.

**2.2 — Ausência de context engineering como disciplina.**
Não há indício de compactação de contexto entre fases longas (arquitetura → testes → segurança → review → limpeza) nem de "context awareness" (o agente saber quanto espaço de contexto resta antes de estourar). Você já tem uma vantagem aqui — cada card/worktree é naturalmente um contexto isolado — mas dentro de uma sessão longa isso ainda pode degradar.

**2.3 — Repair loop restrito a um único caso.**
O padrão "tenta consertar 1x com instrução estreita antes de escalar pro humano" só existe para a URL não subir. Testes falhando, gate de segurança reprovado ou lint quebrado aparentemente vão direto para aprovação humana, sem uma tentativa de autorreparo. Isso é a lacuna mais direta em relação ao "autoresolutivo" que você pediu.

**2.4 — Papéis fixos, não skills plugáveis.**
`rufus`, `testudo`, `escudo`, `crivo`, `pura` são agentes hardcoded no motor, não unidades de instrução carregáveis. Skill de verdade é algo que você adiciona sem tocar em `lib/runner/`.

**2.5 — MCP como caso especial, não camada de tools.**
Hoje MCP aparece só para leitura read-only de banco. Não há indicação de MCP como mecanismo genérico de tools que qualquer harness possa usar (buscar documentação, chamar API externa, consultar ticket). Isso limita bastante a plugabilidade que você quer.

**2.6 — Ausência de evaluator subjetivo formal.**
Os gates determinísticos estão ótimos, mas para qualidade não-binária (esse refactor de arquitetura faz sentido? esse teste cobre o caso certo?) não fica claro se `crivo` opera como um avaliador formal — com critério escrito e loop até aprovar ou esgotar tentativas — ou como um passo único sem circuito fechado.

**2.7 — `kimi` sem health-probe real.**
Você mesmo documentou: cai em `return true` sem testar. Afeta diretamente a confiabilidade de "rodar de forma independente".

**2.8 — Perfil de risco autodeclarado no card.**
Se `risk: high` é algo que a própria IA escreve no card, é um vetor de bypass: um agente pode subdeclarar risco para pular gates de segurança/teste. Falta uma checagem determinística adicional que **suba** o rigor com base no diff, independente do que o card diz — nunca que o baixe.

---

### 3. Padrões recomendados — sem dependência de terceiros

#### 3.1 Harness formal

```ts
// lib/ai/harness.ts
interface HarnessInvocation {
  role: 'implement' | 'verify' | 'gate' | 'step' | 'classificacao';
  prompt: string;
  tools?: ToolSpec[];
  cwd: string;
  effort?: 'low' | 'medium' | 'high';
}

interface HarnessResult {
  output: string;
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
  exitReason: 'completed' | 'error' | 'timeout' | 'quota';
}

interface HarnessCapabilities {
  restrictsTools: boolean;
  isolatesRead: boolean;
  reportsCost: boolean;
  acceptsEffort: boolean;
  mcp: boolean;
}

interface Harness {
  readonly id: string; // 'claude' | 'codex' | 'kimi' | 'qwen' | 'ollama' | ...
  healthCheck(): Promise<boolean>;
  capabilities(): HarnessCapabilities;
  invoke(req: HarnessInvocation): Promise<HarnessResult>;
}
```

Cada provedor atual vira uma implementação em `lib/ai/harnesses/<id>.ts`, registrada num mapa simples (`Record<string, Harness>`). Adicionar Qwen Code passa a ser **um arquivo novo + uma linha de registro**, zero mudança em `runner/` ou `pipeline`. `recusaPorLimite` continua funcionando igual, só passa a consultar `capabilities()` da interface em vez de checar provedor por nome.

#### 3.2 Repair loop genérico (o coração do "autoresolutivo")

Generalizar exatamente o padrão que você já validou pra URL:

```ts
// lib/runner/repair-loop.ts
interface GateVerdict {
  status: 'ok' | 'falhou' | 'inconclusivo';
  detail: string;
}

interface RepairableGate {
  name: string;
  run(ctx: GateContext): Promise<GateVerdict>;
  narrowFix(ctx: GateContext, verdict: GateVerdict): HarnessInvocation; // instrução estreita, nunca recomeço
}

async function runWithRepair(
  gate: RepairableGate,
  ctx: GateContext,
  harness: Harness,
  maxAttempts: number,
): Promise<{ verdict: GateVerdict; attempts: number }> {
  let verdict = await gate.run(ctx);
  let attempts = 0;
  while (verdict.status === 'falhou' && attempts < maxAttempts) {
    await harness.invoke(gate.narrowFix(ctx, verdict));
    verdict = await gate.run(ctx);
    attempts += 1;
  }
  return { verdict, attempts }; // esgotou -> sobe pro humano com o relato, igual já faz hoje pra URL
}
```

Aplicar essa mesma função em `testes`, `seguranca` e `review`, reaproveitando a filosofia que você já provou funcionar: **uma tentativa dirigida, não um loop sem teto, e sempre reportando ao humano o que já foi tentado quando esgota.**

#### 3.3 Skills nativas, sem framework

Convenção simples: `skills/<nome>/SKILL.md` com frontmatter (id, papéis aplicáveis, gatilho) + corpo de instrução. Isso é literalmente a mesma filosofia que você já usa pra cards ("arquivo é a fonte de verdade") aplicada a instrução de agente.

```ts
interface Skill {
  id: string;
  appliesToRoles: string[];
  trigger: (ctx: GateContext) => boolean; // determinístico — não pergunta pra IA se aplica
  instructions: string; // corpo do SKILL.md, injetado no prompt do papel
}
```

Isso deixa `rufus/testudo/escudo/crivo/pura` migrarem de "agente fixo no código" para "papel + skill(s) carregada(s) do disco" — cresce sem inchar `lib/runner/`, e você pode versionar skills por repo-alvo em `<alvo>/.hii/skills/`, sobrepondo as globais, do mesmo jeito que já faz com `pipeline.json`.

#### 3.4 MCP como camada de tools genérica

Formalizar `.hii/mcp.json` por repo-alvo, expondo servidores MCP como tools disponíveis para qualquer harness que declare `capabilities().mcp = true`. O uso atual (banco read-only) passa a ser **um servidor MCP entre outros**, não um caso hardcoded — abre caminho pra documentação, APIs externas, sistemas de ticket, sem adicionar SDK nenhum (MCP já é protocolo aberto, não é dependência de fornecedor).

#### 3.5 Evaluator-Optimizer explícito no `review`

Separar formalmente papel de quem implementa do papel de quem avalia, com critério escrito e versionado:

```
config/review-criteria.json   # checklist objetivo, versionável, auditável
```

`crivo` passa a rodar contra esse critério explícito, reprovar volta pro implementador **com o motivo**, aprovar segue — fechando o circuito gerador↔crítico que caracteriza o padrão evaluator-optimizer, em vez de um passo único sem loop.

**Refinamento 2026 — modo Gauntlet pra avaliação subjetiva.** `review-criteria.json` cobre bem avaliação objetiva ("a lógica está certa? o teste cobre o caso?"). Pra domínio subjetivo — UI, tela de jogo, sensação de interação — o padrão mais rigoroso documentado hoje é o *Gauntlet Loop* (Matt Shumer, 2026): o crítico compara o resultado real contra uma **referência externa concreta e buscável** (captura de tela de um produto real, exemplo publicado) em comparação cega, em vez de julgar contra uma lista de critérios escritos. É o mesmo princípio de "quem implementa nunca se autoavalia" — só trocando o critério escrito por uma referência de mercado real, quando ela existe e é comparável.

Vale como um segundo modo do `crivo`, escolhido pelo domínio ativo: skill pack `frontend-web`/`games-multiplatform` habilita `modo: gauntlet`; domínio de lógica de negócio pura (ex: cálculo de comissão do CashBarber) continua em `review-criteria.json` — não existe screenshot de referência pra "comissão calculada certo". Boundary explícito é obrigatório nesse modo: relatos de mercado registram sessões de centenas de dólares sem teto declarado — reusa o `orcamentoPorCard` já recomendado (Parte V, seção 4) antes de ligar esse modo pra qualquer card.

#### 3.6 Guarda determinística sobre o perfil de risco

Antes de confiar em `risk: high`/`risk: low` declarado no card, rodar heurística sobre o diff:

```ts
const FORCA_COMPLETO = [/^migrations\//, /^app\/Auth\//, /payment/i, /\.env/];
function riskFromDiff(files: string[]): 'completo' | null {
  return files.some(f => FORCA_COMPLETO.some(rx => rx.test(f))) ? 'completo' : null;
}
```

Regra: **o card pode subir o rigor, nunca baixar.** Fecha o vetor onde um agente (ou um humano apressado) subdeclara risco pra pular gate.

#### 3.7 `kimi` com health-probe real

Ponto pontual, mas rápido de resolver: dar ao `kimi` o mesmo tratamento de `claude`/`codex` em `health-probe.ts` (checagem de alcançabilidade real da API), em vez do `return true` implícito.

#### 3.8 Observabilidade por evento, não só por chamada de IA

Estender o ledger (já muito bom) com trace por evento de fase, em JSONL append-only — sem OpenTelemetry, sem dependência externa:

```
{"ts":"...","card":"023","evento":"gate_start","gate":"testes"}
{"ts":"...","card":"023","evento":"repair_attempt","gate":"testes","tentativa":1}
{"ts":"...","card":"023","evento":"gate_verdict","gate":"testes","status":"ok"}
{"ts":"...","card":"023","evento":"human_checkpoint","tipo":"aprovacao_url"}
```

Dá rastreabilidade completa de *por que* um card custou/demorou o que custou, sem sair do "zero dependência de terceiros".

#### 3.9 Manifesto de grafo declarado (sem virar motor de grafo)

Vale checar contra o que a indústria está chamando de "graph engineering" em 2026: a distinção que se consolidou é *loop engineering* (como um nó agente executa sozinho — é onde o Gauntlet Loop da seção 3.5 vive) versus *graph engineering* (a topologia de quem existe, quais transições são permitidas, como o trabalho flui entre nós). O aviso mais repetido nas fontes atuais sobre o tema é justamente o que já está na seção 4 abaixo: a maioria das tarefas não precisa de grafo, e adotar um motor de grafo antes do trabalho exigir de verdade é comprar um problema de sistema distribuído que você não tinha. Ou seja — a cautela já registrada aqui bate com o consenso mais recente, não é uma lacuna.

A única peça que vale adotar, de baixo custo: declarar a topologia (papéis, gates, transições permitidas) como **dado inspecionável**, mesmo que a execução continue sendo uma travessia linear por card, sem virar motor de grafo dinâmico:

```json
// config/topologia.json — dado, não motor
{
  "nos": ["planejador", "implementador", "reparador", "seguranca", "avaliador", "documentador", "empacotador", "aprendiz"],
  "transicoesPermitidas": [
    ["planejador", "implementador"],
    ["implementador", "reparador"],
    ["reparador", "seguranca"],
    ["seguranca", "avaliador"],
    ["avaliador", "documentador"],
    ["documentador", "empacotador"]
  ],
  "checkpointsHumanos": ["confirmacao_plano", "pr_merge"]
}
```

Isso dá auditabilidade e proteção contra deriva (um papel novo tentando pular direto pra `empacotador` sem passar por `avaliador` fica visível e checável) sem pagar o custo de estado distribuído, retry de grafo e migração de esquema que um motor de grafo de verdade exige. Continua sendo o `core/` decidindo tudo — o arquivo é só a foto do que ele já faz, usada pra validar, não pra executar.

---

### 4. O que não mexer

- **Pipeline determinístico de estados** — é a espinha dorsal certa, não trocar por grafo livre sem um caso real que o justifique. O consenso de 2026 sobre "graph engineering" (seção 3.9) confirma essa cautela em vez de contradizê-la.
- **Gate fechando por exit code em disco** — nunca substituir por "o modelo diz que passou".
- **Parede humana no merge** — inegociável.
- **Cota estourada para, sem troca automática de provedor** — mantém; troca automática é exatamente o tipo de decisão que precisa de consentimento explícito.
- **Ausência de framework de orquestração genérico** (LangGraph/CrewAI/AutoGen) — correto continuar sem. Seu estado (cards, worktree, gates em disco) é específico o bastante para que um framework genérico atrapalhe mais do que ajude.

---

### 5. Roadmap sugerido (impacto × esforço)

*Este foi o primeiro roadmap desta análise — os itens 1-2 dele foram incorporados como itens 1-2 do roadmap consolidado (Parte III, seção 10, e Parte VII no fim deste arquivo), que é a lista mestre atualizada. Fica mantido aqui por completude histórica.*

| Ordem | Item | Por quê primeiro |
|---|---|---|
| 1 | Harness interface formal (3.1) | Habilita Qwen/DeepSeek/Gemini CLI imediatamente, risco zero pro resto do motor |
| 2 | Guarda determinística de risco sobre o diff (3.6) | Poucas linhas, fecha um vetor de bypass de gate hoje |
| 3 | Generalizar repair-loop pra testes/segurança (3.2) | Maior ganho direto em "autoresolutivo" |
| 4 | `kimi` com health-probe real (3.7) | Rápido, remove um ponto cego de confiabilidade |
| 5 | Skills nativas via SKILL.md (3.3) | Desacopla papéis fixos, prepara pra crescer sem inchar o core |
| 6 | MCP como camada de tools genérica (3.4) | Abre plugabilidade real além do banco |
| 7 | Evaluator formal com critério versionado no `review` (3.5) | Fecha o circuito gerador↔crítico que hoje é implícito |
| 8 | Observabilidade por evento (3.8) | Nice-to-have, mas barato depois que o resto existe |

Os itens 1–3 sozinhos já entregam o essencial do que você pediu: motor plugável a qualquer IA sem reescrever o core, e capaz de se autocorrigir dentro de limites antes de acionar você.


---

## Parte II — Comparativo com Outros Ecossistemas de Orquestração

Adiciona ECC, wshobson/agents, oh-my-claudecode (OMC) e Ruflo à comparação anterior com Maestro Orchestrate. Metodologia: leitura direta do README/docs de cada repositório (não benchmark rodado). Estrelas e forks são citados como sinal de adoção, não de qualidade técnica — os dois nem sempre andam juntos, como fica claro abaixo.

---

### 1. Tabela comparativa

| Dimensão | **hii** | **Maestro** | **ECC** | **wshobson/agents** | **oh-my-claudecode** | **Ruflo** |
|---|---|---|---|---|---|---|
| Camada arquitetural | Motor standalone (daemon próprio) | Plugin dentro do host | Plugin + hooks dentro do host (v2.0 começa a ter control-plane próprio em Rust, `ecc2/`) | Plugin/marketplace dentro do host | Plugin dentro do Claude Code + workers via tmux | Plugin/MCP server dentro do host + engine Rust próprio (`npx ruflo`) |
| Roda fora do CLI host? | Sim, sempre | Não | Não (exceto protótipo `ecc2`) | Não | Parcialmente (tmux spawna processos reais de CLI) | Parcialmente (engine Rust separado, mas execução de código ainda passa pelo host) |
| Isolamento de execução | Git worktree por card, sempre | Herda do host | Herda do host | Herda do host | Opcional/em desenvolvimento (worktree por worker ainda não é padrão) | Herda do host |
| Gate de qualidade | Determinístico — exit code real em disco, retry limitado documentado, escalonamento pro humano | Review final bloqueia em findings Critical/Major (LLM) | Hooks determinísticos + workflow TDD RED→GREEN→REFACTOR com evidência | Framework de avaliação dedicado (`plugin-eval`): estático + LLM judge + Monte Carlo | "UltraQA" cicla até build/lint/test passarem — teto de tentativas não documentado claramente | Não documentado como gate formal; foco é coordenação, não verificação |
| Amplitude (agentes/skills) | 5 papéis fixos | 39 especialistas | 68 agentes, 286 skills, 94 comandos | 202 agentes, 180 skills, 91 plugins, 16 orquestradores | 19 agentes especializados, múltiplos "modos" de orquestração | Swarm de agentes configurável por topologia, memória adaptativa |
| Harnesses suportados | N/A (motor próprio invoca CLIs) | Gemini CLI, Claude Code, Codex, Qwen Code | Claude Code, Codex, Cursor, OpenCode, Gemini, Zed, Qwen, Kimi, Hermes, OpenClaw, CodeBuddy, JoyCode, Copilot | Claude Code, Codex CLI, Cursor, OpenCode, Gemini CLI, Copilot | Claude Code (+ tmux workers para Codex/Gemini/Antigravity/Grok/Cursor) | Claude Code, Codex, Hermes + modelos via OpenRouter (Qwen, Gemini, GPT) no chat web |
| Observabilidade | Ledger por chamada de IA (papel, tokens, custo) | Não documentado | Dashboard, status snapshots, AgentShield (scan de segurança do próprio harness) | — | HUD statusline, replay logs JSONL, relatório de fricção | — |
| Memória entre sessões | Não | Não | Memory Vault — Markdown portátil entre harnesses, com fronteira de confiança explícita ("memória não é política executável") | — | Skills extraídas de sessões ("skillify") | Memória adaptativa com namespaces, self-learning |
| Licença | Seu projeto | Apache-2.0 | MIT | MIT | MIT | Código aberto (parte do stack maior do mantenedor) |
| Sinal de maturidade | 263 commits, seu | 432 stars, 12 releases semver | 2.428 commits, mantenedor único, ships semanalmente | 38,9k stars, 546 commits | 38,4k stars, 3.440 commits | 68,2k stars, mas ecossistema com múltiplos produtos e página própria de "provenance dossier" para verificar métricas |
| Ponto de atenção | Ainda sem harness formal nem skills plugáveis (ver Parte I) | Sem sandbox própria, sem ledger de custo | Superfície gigantesca (297+ componentes) — risco de complexidade além do necessário | Fortemente opinativo em tiers de modelo pré-definidos | Muitos modos sobrepostos (Team/Autopilot/Ultrawork/Ralph/Pipeline) — risco de "explosão de opções"; isolamento por worktree ainda não é padrão | Rebrand recente (Claude-Flow → Ruflo), ecossistema com muitos produtos satélite e linguagem de marketing forte; vale checar mudanças de versão com atenção (o changelog já registrou artefato npm publicado com commits que vieram depois da tag) |

---

### 2. O que cada um faz de único (resumo qualitativo)

**ECC** — provavelmente a biblioteca de skills mais completa hoje para múltiplos harnesses. Dois detalhes valem nota: o **Memory Vault** trata memória entre sessões como "contexto não revisado, nunca política executável" — separação explícita entre lembrar e confiar, um cuidado de segurança que qualquer sistema de memória deveria copiar. E o **AgentShield** escaneia a própria configuração do agente (hooks, MCP, permissões, segredos) como superfície de ataque — tratar a config do agente como algo que também precisa de auditoria, não só o código que ele produz.

**wshobson/agents** — o mais rigoroso em avaliação de qualidade de skill: `plugin-eval` roda checagem estrutural determinística, depois um "juiz" LLM em 4 dimensões, depois confiabilidade estatística via 50–100 simulações Monte Carlo antes de certificar um plugin. Também usa uma estratégia de modelo em camadas (tarefa longa/arquitetura → modelo caro; tarefa operacional → modelo barato) de forma explícita e documentada.

**oh-my-claudecode** — o mais ambicioso em paralelismo real: `omc team N:codex` sobe processos de verdade em painéis tmux, não só subagentes simulados dentro do mesmo processo. Tem um modo (`Ralph`) que é essencialmente "não desiste até verificar que terminou" — parente direto do que você quer com "autoresolutivo". Em contrapartida, é o projeto com mais modos sobrepostos (Team, Autopilot, Ultrawork, Ralph, Pipeline, Ultrapilot legado) — a Anthropic cita exatamente esse tipo de sprawl como o principal modo de falha em sistemas de agente.

**Ruflo** (ex-Claude-Flow) — o único dos quatro com engine própria em Rust e roteamento nativo para múltiplos modelos (Qwen, Gemini, Claude, GPT) via OpenRouter num chat web, além do MCP server para swarm/memória. É o mais "infraestrutura pesada" dos quatro, mas também o que tem a superfície mais difícil de auditar de fora — vale mais cautela antes de adotar em produção, não porque algo esteja necessariamente errado, mas porque o próprio mantenedor publica página de verificação/proveniência para suas métricas, o que por si só sinaliza que essa é uma pergunta que já foi feita por outras pessoas.

---

### 3. Qual é mais robusto

Continua não sendo uma resposta de "um vence todos" — são camadas diferentes:

- **Confiabilidade de execução (gate real, isolamento, custo rastreado, sem depender do host se comportar bem):** hii continua na frente de todos os cinco. Nenhum dos outros tem o equivalente ao "gate fecha por exit code em disco, nunca pela fala do modelo" como política central e testada.
- **Amplitude e maturidade de skills:** wshobson/agents e ECC são visivelmente mais maduros — mais componentes, mais harnesses, processo de avaliação de qualidade (wshobson) e boas práticas de segurança de memória (ECC) que valem a pena estudar.
- **Paralelismo real entre CLIs diferentes:** oh-my-claudecode é o mais avançado tecnicamente (tmux com processos reais), mas ao custo de complexidade de modos que a própria literatura desaconselha.
- **Infraestrutura de swarm/memória própria:** Ruflo é o mais ambicioso, mas o mais difícil de avaliar de fora e o que exige mais ceticismo antes de adotar.

---

### 4. Múltiplos orquestradores no mesmo projeto — resposta reforçada

A pergunta ficou mais fácil de responder depois de ler os cinco: **isso já é um problema documentado nos próprios projetos**, não só uma preocupação teórica minha. O ECC avisa explicitamente: instalar duas vezes no mesmo harness duplica skills, comandos, hooks e configuração — e dá instrução expressa de "escolha um caminho de instalação por harness, não empilhe". Isso é exatamente o risco que eu tinha te sinalizado antes, só que agora com um exemplo real e documentado de alguém que já bateu nesse problema em produção.

Isso não muda minha recomendação, reforça ela:

1. **hii continua sendo o único dono do ciclo de vida** (worktree, gate, custo, PR, merge) — nenhum desses cinco projetos tenta ser isso, todos vivem dentro do host CLI.
2. **ECC e wshobson/agents são as melhores fontes de conteúdo para o seu sistema de skills** (recomendação 3.3 da Parte I) — não para instalar como estão, mas para adaptar seletivamente: os pacotes Laravel do ECC (`laravel-patterns`, `laravel-security`, `laravel-tdd`, `laravel-verification`) são diretamente relevantes ao seu stack no CashBarber.
3. **O framework `plugin-eval` do wshobson/agents é um modelo direto para a recomendação 3.5** (evaluator formal) — vale estudar a estrutura de 3 camadas (estático → juiz LLM → Monte Carlo) para o seu próprio `crivo`.
4. **O padrão de fronteira de confiança de memória do ECC** vale adotar sempre que o hii ganhar algum tipo de memória entre sessões — nunca tratar o que foi lembrado como instrução executável sem revisão.

Ou seja: continue não instalando nenhum desses como orquestrador paralelo. Trate todos os cinco como **catálogo de referência** para robustecer o hii — que é exatamente o papel que "sem dependência de terceiros, mas plugável" pede.


---

## Parte III — Catálogo de Papéis, Skills e Cadeia de Execução

Este documento estuda o que cada orquestrador analisado (Maestro, ECC, wshobson/agents, oh-my-claudecode, Ruflo) faz de melhor em nível de **agente e skill individual** — não de motor — e propõe uma versão própria, nativa do hii, sem adotar nenhum deles como dependência. O objetivo é fechar a cadeia completa de execução de uma tarefa de desenvolvimento de software, do pedido inicial até o deploy, cobrindo desde um site simples até sistemas complexos em qualquer linguagem, incluindo jogos multiplataforma.

---

### 0. Dois princípios de design antes do catálogo

**Princípio 1 — Um único modelo de execução, profundidade configurável.**
O oh-my-claudecode acumulou seis modos concorrentes (Team, Autopilot, Ultrawork, Ralph, Pipeline, Ultrapilot legado) que se sobrepõem parcialmente — e isso é citado pela própria literatura de agentes como o principal jeito de um sistema virar difícil de prever. O hii já evita isso: um pipeline de card só, com perfis (`enxuto/completo/deps/padrao/externo`) controlando profundidade. Nada do que segue abaixo deve virar um "modo" novo — deve virar mais um papel ou skill dentro do mesmo pipeline.

**Princípio 2 — Skill é conteúdo, papel é quem carrega o conteúdo.**
Seguindo a distinção que o ECC deixa mais clara que qualquer outro projeto: **skill** é conhecimento reutilizável carregado sob demanda (ex: "padrões de Laravel"), **papel/agente** é quem tem permissão e contexto para agir (ex: "implementador"). Um papel pode carregar várias skills; uma skill nunca age sozinha. O catálogo abaixo separa os dois por esse motivo.

---

### 1. A cadeia de execução completa proposta

```
intake -> descoberta -> plano -> confirmacao_humana -> implementacao (TDD)
   -> reparo_de_build -> seguranca -> revisao_contexto_fresco -> documentacao
   -> empacotamento/deploy -> parede_humana/PR -> aprendizado_final (aprendiz)
```

| # | Fase | O que faz | Inspirado em | Já existe no hii? |
|---|---|---|---|---|
| 1 | Intake | Card criado a partir do pedido, perfil de risco calculado do diff (não autodeclarado) | Recomendação anterior (guarda determinística de risco) | Parcial — falta a guarda sobre o diff |
| 2 | Descoberta | Pesquisa no próprio repo/deps antes de escrever qualquer linha — "procurar antes de codar" | `search-first` (ECC) | Não |
| 3 | Plano | Agente de arquitetura escreve plano como artefato editável, não como texto perdido no chat | `planner`/`architect` (ECC), Plan Canvas (Maestro), `ralplan` (OMC) | Parcial — perfil `completo` já tem etapa de arquitetura |
| 4 | Confirmação humana do plano | Humano aprova/edita o plano antes da implementação começar | Plan Canvas (Maestro) | Não — hoje a parede humana só existe no merge final |
| 5 | Implementação guiada por TDD | RED (teste falha) → GREEN (implementa) → evidência anexada ao card | `tdd-workflow`, `tdd-guide` (ECC) | Parcial — perfil `completo` roda testes, mas não força RED antes do GREEN |
| 6 | Reparo de build por domínio | Falha de build/teste aciona um reparador especialista na linguagem/engine, não um reparo genérico | `*-build-resolver` por linguagem (ECC) | Não — só existe pra URL (recomendação 3.2 da Parte I) |
| 7 | Segurança | Checklist de vulnerabilidade específico da stack tocada | `security-review`, `*-security` por stack (ECC) | Parcial — existe `escudo`, mas sem checklist versionado por stack |
| 8 | Revisão em contexto fresco | Quem revisa nunca é quem implementou na mesma sessão/contexto | `code-reviewer` (ECC), `plugin-eval` (wshobson) | Parcial — existe `crivo`, falta formalizar como avaliador com critério escrito |
| 9 | Documentação | Docs atualizadas automaticamente quando a mudança afeta contrato público | `doc-updater`, `docs-lookup` (ECC) | Não |
| 10 | Empacotamento/Deploy | Build de produção específico do tipo de projeto (web, mobile, desktop, jogo) | `deployment-patterns`, `docker-patterns` (ECC) | Não |
| 11 | Parede humana / PR | Merge nunca automático | — | Sim, já existe |
| 12 | Aprendizado final (`aprendiz`) | Roda uma vez ao fechar o card. Padrão isolado vira candidato a skill; padrão recorrente (≥N cards) vira **regra inegociável** que o gate passa a cobrar, sem interpretação de modelo | `continuous-learning-v2`/Memory Vault (ECC), `skillify` (OMC) + guarda de risco (Parte I, 3.6) | Não |

As fases 2, 4, 6, 9, 10 e 12 são as lacunas reais. O resto do documento detalha como fechá-las.

---

### 2. Catálogo de skills por domínio (packs)

Estrutura de arquivo proposta, seguindo a recomendação 3.3 do Parte I:

```
skills/
  common/                  # sempre carregado
  backend-web/
  frontend-web/
  mobile/
  systems-languages/
  data-ml/
  games-multiplatform/     # gap que nenhum dos 5 projetos cobre bem
  devops-deploy/
```

Cada skill seleciona seu papel-alvo e seu gatilho de forma **determinística** (arquivo tocado, extensão, dependência declarada em `composer.json`/`package.json`/`*.csproj`/etc.) — nunca "pergunta pra IA se aplica", conforme já recomendado.

#### 2.1 `common/` (sempre ativo)

| Skill | O que cobre | Inspirado em |
|---|---|---|
| `coding-standards` | Convenções gerais de nomenclatura, organização de arquivo | `coding-standards` (ECC) |
| `git-workflow` | Formato de commit, estratégia de branch/worktree | `git-workflow` (ECC) |
| `api-design` | Paginação, formato de erro, versionamento de contrato | `api-design` (ECC) |
| `security-baseline` | OWASP Top 10 genérico, aplicado antes do checklist específico de stack | `security-review` (ECC) |

#### 2.2 `backend-web/` — direto aproveitável no CashBarber

| Skill | Cobre | Fonte de referência |
|---|---|---|
| `laravel-patterns` | Arquitetura de camadas, Eloquent, jobs/queues | ECC (`laravel-patterns`) |
| `laravel-security` | Mass assignment, autorização por policy, sanitização | ECC (`laravel-security`) |
| `laravel-tdd` | Convenção de teste com Pest/PHPUnit | ECC (`laravel-tdd`) |
| `laravel-verification` | Checklist de verificação pré-PR específico Laravel | ECC (`laravel-verification`) |
| `database-migrations` | Padrão de migration reversível, cuidado com dado em produção | ECC (`database-migrations`) |
| `postgres-patterns`/`mysql-patterns` | Otimização de query, índice, `only_full_group_by` (seu caso real recente) | ECC (`postgres-patterns`), adaptado pra MySQL |

#### 2.3 `frontend-web/`

| Skill | Cobre | Fonte |
|---|---|---|
| `frontend-patterns` | Componentização, gerenciamento de estado | ECC |
| `accessibility-a11y` | Checklist WCAG aplicável a qualquer stack front | Maestro (especialista a11y) |
| `seo-technical` | Meta tags, performance de carregamento, structured data | Maestro (especialista SEO), wshobson |

#### 2.4 `mobile/`

| Skill | Cobre | Fonte |
|---|---|---|
| `swift-concurrency` | Async/await moderno, actors | ECC (`swift-concurrency-6-2`) |
| `kotlin-patterns` | Coroutines, Android lifecycle | ECC (`kotlin-*`) |
| `react-native-patterns` | Bridge nativo, performance de lista | proposto (nenhum dos 5 cobre) |

#### 2.5 `systems-languages/`

| Skill | Cobre | Fonte |
|---|---|---|
| `cpp-coding-standards` | C++ Core Guidelines | ECC |
| `rust-patterns` | Ownership, error handling idiomático | ECC (`rust-reviewer`) |
| `go-patterns` | Idiomas Go, concorrência | ECC (`golang-patterns`) |

#### 2.6 `games-multiplatform/` — proposta nova, nenhum dos 5 cobre bem

Nenhum dos cinco projetos estudados tem um pacote dedicado a jogos — é o gap mais claro frente ao que você pediu. Proposta, seguindo o mesmo padrão de "reviewer + build-resolver + security + verification" que o ECC usa por linguagem:

| Skill | Cobre |
|---|---|
| `game-engine-unity-csharp` | Padrões de MonoBehaviour, ScriptableObject, pooling de objetos, evitar `Update()` custoso |
| `game-engine-godot-gdscript` | Padrões de nó/cena, sinais em vez de referência direta |
| `game-engine-unreal-cpp` | UObject lifecycle, replicação, Blueprint vs C++ |
| `realtime-performance-profiling` | Orçamento de frame, GC pressure, perfil por plataforma |
| `netcode-multiplayer-patterns` | Client prediction, reconciliação server-authoritative, tolerância a lag |
| `cross-platform-build` | Requisitos de certificação por loja (Steam/iOS/Android/console), build matrix |
| `deterministic-replay-testing` | Teste de gameplay via replay determinístico em vez de screenshot flakiness |

Isso cobre exatamente a lacuna "chegando até criação de jogos multiplataformas" do seu pedido — como skill, não como mudança de motor: o hii continua orquestrando igual, só muda o conteúdo que injeta no papel de implementação quando detecta `.csproj`/`project.godot`/`*.uproject` no diff.

#### 2.7 `data-ml/`

| Skill | Cobre | Fonte |
|---|---|---|
| `mle-workflow` | Contrato de dado, eval, monitoramento de modelo em produção | ECC |
| `cost-aware-llm-pipeline` | Roteamento de modelo por custo/tarefa — reaproveitável no próprio hii | ECC |

#### 2.8 `devops-deploy/`

| Skill | Cobre | Fonte |
|---|---|---|
| `docker-patterns` | Compose, rede, segurança de container | ECC |
| `deployment-patterns` | CI/CD, rollback, health check | ECC |
| `cross-platform-build` | (ver 2.6, reaproveitado por apps desktop também) | proposto |

---

### 3. Papéis (agents) — generalização dos 5 fixos

Em vez de `rufus/testudo/escudo/crivo/pura` como código hardcoded, cada papel vira um **loadout**: contexto + permissões + lista de skills elegíveis, resolvida em runtime pelo gatilho determinístico da skill.

```ts
// lib/runner/role.ts
interface RoleLoadout {
  role: 'planejador' | 'implementador' | 'reparador' | 'seguranca' | 'avaliador' | 'documentador' | 'empacotador' | 'aprendiz';
  tools: ToolSpec[];               // permissões mínimas necessárias
  skillPacks: string[];            // ex: ['common', 'backend-web', 'games-multiplatform']
  harnessPreference?: string;      // sugestão de provedor, não obrigação
}
```

`aprendiz` é diferente dos outros sete: roda uma única vez, no fechamento do card, nunca durante a execução — detalhado na seção 6.

O papel `implementador` de hoje (que hardcoda Laravel implicitamente por causa do seu domínio de trabalho) passa a resolver skills por gatilho de diff, e por isso o mesmo motor atende Laravel, um jogo em Godot ou um app React Native sem mudança de código no core — só mudando o conteúdo de `skills/`.

#### 3.1 Despacho dinâmico de agentes (Orchestrator-Workers dentro do `core/`)

O pipeline de card continua único e sequencial nas fases macro (Princípio 1). Mas dentro de uma fase — sobretudo `implementacao` e `seguranca` — nem sempre um papel fixo dá conta: às vezes o card pede dois especialistas rodando ao mesmo tempo (ex: `a11y` + `seguranca` no mesmo componente de front). Isso se resolve dentro do próprio `core/`, sem virar motor novo — é a resposta prática pra "ter um orquestrador meu pra executar os agentes": a capacidade já mora dentro do hii, só faltava essa função.

```ts
// core/agent-executor.ts
interface AgentRun {
  skillId: string;          // conteúdo a carregar (skills/_native ou skills/_sources)
  role: RoleLoadout;
  maxTurns: number;         // mesmo teto do repair-loop, nunca sem limite
  onDone: (result: HarnessResult) => GateVerdict;
}

async function runAgent(spec: AgentRun): Promise<GateVerdict> {
  // usa o Harness já registrado, escreve no mesmo ledger,
  // reporta pro mesmo pipeline de card — não é processo novo.
}

async function runAgentsInPhase(specs: AgentRun[]): Promise<GateVerdict[]> {
  return Promise.all(specs.map(runAgent)); // paralelo quando as skills não tocam os mesmos arquivos
}
```

Quem decide `specs` (quantos agentes, quais skills) é uma função determinística que lê o diff/card — nunca "a IA decide se chama outro agente". Isso fecha o padrão *Orchestrator-Workers* que Maestro (39 especialistas) e ECC (68 agentes) resolvem com despacho dinâmico, sem abrir mão do Princípio 1: continua sendo uma fase do mesmo pipeline, só que capaz de rodar mais de um especialista dentro dela.

---

### 4. Reparo automático por domínio (generalização da recomendação 3.2)

O padrão mais direto e replicável de todo o levantamento é o do ECC: um reparador especializado por build system, não um reparo genérico. Formalizando como extensão do `repair-loop` já proposto:

```ts
// lib/runner/repair-registry.ts
interface BuildRepairer {
  detects: (files: string[]) => boolean;   // ex: arquivo .csproj no diff
  runCheck: (ctx: GateContext) => Promise<GateVerdict>;
  narrowFix: (ctx: GateContext, verdict: GateVerdict) => HarnessInvocation;
}

const repairers: BuildRepairer[] = [
  laravelPhpRepairer,
  goBuildRepairer,
  rustBuildRepairer,
  unityCsharpRepairer,
  godotGdscriptRepairer,
  // um arquivo novo por domínio, zero mudança no core
];

function pickRepairer(files: string[]): BuildRepairer | null {
  return repairers.find(r => r.detects(files)) ?? null;
}
```

Isso é literalmente `runWithRepair` (Parte I, seção 3.2) recebendo o `narrowFix` certo pro domínio em vez de um genérico — o próprio ECC tem 8+ desses (`go-build-resolver`, `java-build-resolver`, `kotlin-build-resolver`, `rust-build-resolver`, `cpp-build-resolver`, `pytorch-build-resolver`...), prova de que o padrão escala bem por linguagem.

---

### 5. Avaliação formal de qualidade (evaluator)

O `plugin-eval` do wshobson/agents é o design mais rigoroso encontrado — 3 camadas antes de confiar em algo:

| Camada | O que faz | Custo | Aplicação no hii |
|---|---|---|---|
| Estática | Checagem estrutural determinística (lint, schema do card, convenção de arquivo) | <2s, grátis | Já existe em espírito (gates determinísticos) |
| Juiz LLM | Avaliação semântica em dimensões fixas e escritas (não "parece bom?") | ~30s | Formaliza o `crivo` — critério em `config/review-criteria.json` (recomendação 3.5) |
| Monte Carlo | Roda a mesma skill/prompt N vezes (50-100), mede taxa de sucesso antes de **certificar** uma skill nova | 2-5min | Aplicar só na hora de promover um "instinto" aprendido (seção 6) pra skill oficial — não em toda execução, seria caro demais pro seu caso de uso |

A camada Monte Carlo não faz sentido rodar por card (custo demais pra um SaaS), mas faz todo sentido como **portão de certificação** antes de uma skill nova (escrita por você ou extraída de sessão) entrar em produção — evita skill mal escrita virando fonte de bug sistemático.

---

### 6. Aprendizado final — o papel `aprendiz` e as regras inegociáveis

A fase 12 tem dois produtos diferentes, que não deveriam ser tratados como a mesma coisa:

- **Aprendizado macio (conteúdo)** — vira candidato a skill: instrução nova, ainda opcional, só ajuda quando carregada no contexto certo. Fica em `.hii/instincts/`, segue o fluxo já validado pelo ECC: revisão humana em lote → portão Monte Carlo (seção 5) → skill oficial em `skills/`.
- **Aprendizado duro (regra)** — quando o mesmo problema se repete em cards diferentes, ele deixa de ser "conteúdo que ajuda" e vira **condição que o gate cobra sempre**, sem interpretação de modelo nenhuma. Essa trilha é a resposta direta ao pedido desta conversa.

#### O papel `aprendiz`

Roda uma única vez, no fechamento do card (depois do merge, fase 11), nunca durante a execução. Lê o rastro determinístico do próprio card — eventos de `repair_attempt`, `gate_verdict` reprovado, achado de `seguranca`, rejeição do `avaliador` (ledger por evento, recomendação 3.7 do Parte I) — e não o código em si. Isso importa: `aprendiz` audita *como o card se comportou*, não reescreve a solução nem julga gosto.

```ts
// core/learner.ts
interface ProblemSignature {
  categoria: 'seguranca' | 'build' | 'review' | 'risco';
  padrao: string;            // assinatura estável: hash(dominio + tipo_falha + causa_raiz)
  card: string;
  evidencia: string;         // trecho do ledger que comprova — nunca opinião do modelo
}

async function aprendizFechaCard(card: CardContext): Promise<ProblemSignature[]> {
  const eventos = await lerLedger(card.id);
  return extrairAssinaturas(eventos); // determinístico: agrupa por categoria+causa, o modelo não "acha" o padrão sozinho
}
```

#### Limiar de promoção — por que não vira regra na primeira vez

Uma falha isolada é ruído, não padrão. `aprendiz` só *propõe* uma regra depois que a mesma `ProblemSignature` aparece em **N cards diferentes** (sugestão inicial: N = 3, configurável). Até lá, fica acumulando em `.hii/candidatos-regras/<assinatura>.json`, visível mas sem efeito nenhum no gate:

```json
// .hii/candidatos-regras/seguranca-payment-sem-teste-idempotencia.json
{
  "categoria": "seguranca",
  "padrao": "controller-payment-sem-teste-idempotencia",
  "ocorrencias": [
    { "card": "041", "evidencia": "gate_verdict seguranca falhou: PaymentController sem teste de retry" },
    { "card": "058", "evidencia": "gate_verdict seguranca falhou: mesma classe de achado" },
    { "card": "073", "evidencia": "gate_verdict seguranca falhou: mesma classe de achado" }
  ]
}
```

Isso evita o risco simétrico ao que o ECC documentou pra memória: regra promovida cedo demais, a partir de um caso mal interpretado, virando bloqueio permanente errado. Ao bater o limiar, o candidato sobe pra revisão humana em lote — igual ao instinto macio — mas a decisão aqui é binária e de peso maior: **promover vira regra que passa a bloquear entrega até ser satisfeita**, não uma skill que só ajuda.

#### Onde a regra promovida realmente mora

Não cria mecanismo de enforcement novo — entra direto na guarda determinística de risco já recomendada (Parte I, seção 3.6), generalizando o array `FORCA_COMPLETO` fixo pra um registro que cresce com o tempo, sempre por decisão humana:

```json
// config/regras-inegociaveis.json
{
  "regras": [
    {
      "id": "r-0001",
      "categoria": "seguranca",
      "descricao": "Diff tocando app/Http/Controllers/Payment* exige teste de integração de idempotência",
      "gatilho": { "arquivos": ["app/Http/Controllers/Payment*"] },
      "exigencia": "teste_integracao_idempotencia",
      "origem": { "cards": ["041", "058", "073"], "promovidoEm": "2026-09-01", "promovidoPor": "rafael" }
    }
  ]
}
```

```ts
// core/rule-guard.ts — estende riskFromDiff da recomendação 3.6
function regrasQueBatem(files: string[], regras: RegraInegociavel[]): RegraInegociavel[] {
  return regras.filter(r => r.gatilho.arquivos?.some(padrao => files.some(f => minimatch(f, padrao))));
}
// card pode ganhar mais exigência (mais regras batendo), nunca perder — mesma política de sempre
```

O ponto central do pedido fica resolvido assim: **o aprendizado não termina em mais um texto que a IA pode ou não seguir — termina em código de gate que ela é obrigada a satisfazer**, e só chega lá depois de provar que o problema é recorrente, não hipótese de um card só. Ponto crítico mantido do ECC: nenhuma das duas trilhas é lida de volta como instrução confiável dentro da mesma sessão que a gerou — sempre passa pelo lote de revisão humana primeiro.

---

### 7. Segurança do próprio harness (novo, não estava nas partes anteriores)

O AgentShield do ECC escaneia a configuração do agente como superfície de ataque — não só o código que ele produz. Proposta mínima pro hii:

- Escanear `skills/*/SKILL.md`, `.hii/mcp.json` e hooks em busca de instrução embutida que tente escalar permissão ou desativar gate.
- Rodar isso como um gate a mais, `auditoria_harness`, antes de qualquer skill nova (humana ou promovida da seção 6) ser carregada em produção.
- Baixo custo de implementação: é basicamente grep determinístico por padrões conhecidos de prompt injection + revisão humana pra skill nova, não precisa de modelo nenhum.

---

### 8. Roteamento por tier de esforço/custo

O wshobson/agents formaliza isso melhor que qualquer outro: tarefa de arquitetura/segurança vai pra modelo caro, tarefa operacional (docs, SEO, lint) vai pra modelo barato, tarefa de horizonte longo é opt-in explícito. Isso já existe informalmente no hii (`implement` no claude, `gate` no codex), mas vale formalizar como tabela versionada em vez de decisão implícita no código:

```ts
// config/model-tier.json
{
  "arquitetura": "tier1_caro",
  "seguranca": "tier1_caro",
  "implementacao": "tier2_padrao",
  "reparo_build": "tier2_padrao",
  "documentacao": "tier3_barato",
  "cleanup": "tier3_barato"
}
```

Isso deixa o custo auditável (bate direto com o ledger que você já tem) e facilita trocar qual IA cobre qual tier sem tocar em `lib/runner/`.

---

### 9. Paralelismo real, sem tmux

O oh-my-claudecode sobe processos de verdade em painéis tmux pra paralelizar entre CLIs diferentes. O hii já tem uma forma **mais segura** de fazer o equivalente, sem precisar de tmux como dependência: **N cards em paralelo, cada um com seu próprio worktree e sua própria instância de harness**, coordenados pela fila que você já tem. A vantagem sobre tmux: isolamento de arquivo garantido pelo worktree, não só isolamento de processo — dois workers nunca disputam o mesmo arquivo por acidente. Não precisa de nada novo, é usar o mecanismo de fila + worktree que já existe, só formalizando que ele pode rodar >1 card ao mesmo tempo quando não há dependência declarada entre eles.

Isso é paralelismo *entre* cards. Dentro de um card só, quem paraleliza é `runAgentsInPhase` (seção 3.1) — dois especialistas na mesma fase, mesmo worktree, arquivos diferentes garantidos pelo próprio diff do card. São dois eixos independentes, nenhum dos dois pede tmux nem motor novo.

---

### 10. Roadmap consolidado (juntando com o Parte I)

| Ordem | Item | Fase que fecha |
|---|---|---|
| 1 | Harness interface formal *(já recomendado)* | pré-requisito de tudo |
| 2 | Guarda determinística de risco sobre o diff *(já recomendado)* | Fase 1 |
| 3 | `search-first` como skill de `common/` | Fase 2 |
| 4 | Confirmação humana do plano antes de implementar | Fase 4 |
| 5 | RED antes de GREEN obrigatório no perfil `completo` | Fase 5 |
| 6 | Registro de `BuildRepairer` por domínio, começando por Laravel (o que você já usa) | Fase 6 |
| 7 | Checklist de segurança versionado por stack (`config/security-checklist/<stack>.json`) | Fase 7 |
| 8 | Critério escrito pro `crivo` + Camada 1-2 do `plugin-eval` | Fase 8 |
| 9 | `doc-updater` como papel novo | Fase 9 |
| 10 | Pack `games-multiplatform/` (o gap que nenhum concorrente cobre) | Fase 10 |
| 11 | `core/agent-executor.ts` — despacho dinâmico dentro de uma fase (seção 3.1) | habilita Orchestrator-Workers sem motor novo |
| 12 | Papel `aprendiz` + `.hii/candidatos-regras/` com limiar de promoção (N cards) | Fase 12, parte macia |
| 13 | `config/regras-inegociaveis.json` + `core/rule-guard.ts` | Fase 12, parte dura — fecha o pedido desta conversa |
| 14 | Auditoria do próprio harness (`auditoria_harness`) | Segurança meta |

Os itens 1-2 já estavam na Parte I. Os itens 3, 6 e 10 continuam sendo os de maior retorno imediato: 3 e 6 fecham lacunas reais no seu fluxo de hoje (Laravel), e 10 é o único domínio que nenhum dos cinco projetos estudados cobre. Os itens 12-13 fecham o loop que faltava: aprendizado deixa de ser só "mais um texto pro modelo ler" e passa a virar gate de verdade, só depois de provar recorrência — sem precisar de um segundo orquestrador pra isso.


---

## Parte IV — Modelo de Pastas Multi-Origem

### Em que camada isso entra

Retomando a separação do Parte III (seção 0, Princípio 2): **skill é conteúdo, papel é quem age, core é quem executa e decide.** "Multi-orquestrador" aqui significa **múltiplas origens de conteúdo dentro da camada de skill** — nunca múltiplos motores decidindo ciclo de vida.

```
core/        <- dono único do ciclo de vida, NUNCA duplicado, uma origem só (o seu código)
roles/       <- quem tem permissão de agir, uma origem só
skills/      <- CONTEÚDO — é aqui que "multi-orquestrador" vive
providers/   <- harnesses (claude/codex/kimi/qwen), uma origem só
```

Um agente do ECC ou um especialista do Maestro nunca roda como processo separado dentro do hii. O que entra é o **texto de instrução** dele, adaptado para o formato `SKILL.md` do hii, carregado por um papel do hii, executado pelo harness do hii. "Usar agentes de outros orquestradores" = importar o prompt/conhecimento deles como skill, não importar o motor deles.

---

### Modelo de pastas

```
hii/
├── core/                                  # motor — não mexe nisso aqui
├── roles/                                 # loadouts — não mexe nisso aqui
├── providers/                             # harnesses — não mexe nisso aqui
│
├── skills/
│   ├── _native/                           # skills suas, escritas do zero, sem proveniência externa
│   │   └── laravel-cashbarber/
│   │       └── SKILL.md
│   │
│   ├── _sources/                          # adaptações de catálogos externos — isoladas por origem
│   │   ├── ecc/
│   │   │   ├── ORIGIN.json                # repo, commit importado, licença, data
│   │   │   ├── LICENSE.txt                # cópia da licença original (MIT)
│   │   │   ├── backend-web/laravel-patterns/SKILL.md
│   │   │   ├── mobile/swift-concurrency/SKILL.md
│   │   │   └── games-multiplatform/       # (vazio hoje — nenhuma fonte cobre isso, fica em _native)
│   │   │
│   │   ├── wshobson-agents/
│   │   │   ├── ORIGIN.json
│   │   │   ├── LICENSE.txt                # MIT
│   │   │   └── frontend-web/seo-technical/SKILL.md
│   │   │
│   │   ├── maestro/
│   │   │   ├── ORIGIN.json
│   │   │   ├── LICENSE.txt                # Apache-2.0
│   │   │   └── frontend-web/accessibility-a11y/SKILL.md
│   │   │
│   │   └── omc/
│   │       ├── ORIGIN.json
│   │       ├── LICENSE.txt                # MIT
│   │       └── common/search-first/SKILL.md
│   │
│   └── _resolved/                         # GERADA — é o que o loader do hii realmente lê em runtime
│       ├── common/
│       ├── backend-web/
│       ├── frontend-web/
│       ├── mobile/
│       ├── systems-languages/
│       ├── games-multiplatform/
│       ├── data-ml/
│       └── devops-deploy/
│
└── config/
    └── skill-sources.json                 # registry: qual pack está ativo e de onde vem
```

**Regra de ouro:** ninguém edita `_resolved/` na mão. Ela é recalculada a partir de `_native` + `_sources` toda vez que `skill-sources.json` muda. Isso evita o problema que o próprio ECC documentou (instalação duplicada bagunçando skill/hook) — aqui a fusão é determinística e versionada, não duas instalações brigando pelo mesmo diretório.

---

### `ORIGIN.json` — rastreabilidade de proveniência

Cada pasta em `_sources/<origem>/` carrega isso na raiz, por questão de licença e auditoria (mistura de MIT com Apache-2.0 exige manter atribuição):

```json
{
  "repo": "https://github.com/affaan-m/ECC",
  "importedCommit": "a1b2c3d",
  "importedAt": "2026-08-20",
  "license": "MIT",
  "adaptedBy": "rafaelvpolan",
  "notes": "Apenas o texto de instrução foi adaptado para o formato SKILL.md do hii. Nenhuma dependência de runtime, hook ou script do projeto de origem foi importada."
}
```

---

### `config/skill-sources.json` — o que está ativo e de onde vem

```json
{
  "packs": [
    { "id": "backend-web/laravel-patterns",        "source": "_native" },
    { "id": "mobile/swift-concurrency",             "source": "_sources/ecc" },
    { "id": "frontend-web/seo-technical",           "source": "_sources/wshobson-agents" },
    { "id": "frontend-web/accessibility-a11y",      "source": "_sources/maestro" },
    { "id": "common/search-first",                  "source": "_sources/omc" }
  ],
  "resolutionOrder": ["_native", "_sources/ecc", "_sources/wshobson-agents", "_sources/maestro", "_sources/omc"]
}
```

Regra de resolução: em empate de `id`, quem vem primeiro em `resolutionOrder` vence — `_native` sempre primeiro. Empate sem `_native` envolvido é erro de build, não silenciosamente ignorado (mesma filosofia dos seus gates: falha visível, nunca escondida).

---

### Adaptador — como um "agente" de outro projeto vira skill do hii

Script de importação (roda uma vez por skill trazida, não em runtime):

```ts
// scripts/import-skill-source.ts
interface ExternalAgentDoc {
  sourceId: 'ecc' | 'wshobson-agents' | 'maestro' | 'omc';
  rawMarkdownPath: string;      // ex: caminho do agents/security-reviewer.md original
  targetDomain: string;          // ex: 'backend-web'
  targetSkillId: string;         // ex: 'security-reviewer'
}

function adaptToHiiSkill(doc: ExternalAgentDoc): string {
  // 1. Extrai o corpo de instrução do markdown original
  // 2. Descarta qualquer referência a comando/hook/CLI do projeto de origem
  // 3. Escreve no formato SKILL.md do hii:
  return `---
id: ${doc.targetSkillId}
appliesToRoles: [avaliador]        # preenchido manualmente após revisão humana
trigger: manual                    # trigger determinístico real é definido por você, não pelo import
source: ${doc.sourceId}
---
<corpo de instrução adaptado aqui>`;
}
```

O `trigger` nunca sai do import automático — isso é decisão sua, manual, revisada. O script só resolve a parte mecânica (formato, metadados, remoção de referência a runtime alheio); a parte de "quando essa skill deve carregar" continua sendo julgamento humano, igual já era pras skills nativas.

---

### Onde isso deixa a pergunta de "múltiplos orquestradores"

Com esse modelo, a resposta pra "posso ter multi orquestradores no projeto" fica mais afiada: **você tem conteúdo de cinco origens diferentes convivendo, mas um motor só decidindo o que roda, quando e com qual gate.** É o melhor dos dois mundos que você pediu no início — plugável a qualquer coisa, mas sem duplicar quem manda.


---

## Parte V — Skills Modernas, Orquestração Manual, Blocos, Governança e Pilares

Cinco pedidos desta conversa, nesta ordem: (1) atualizar as skills com referência moderna por setor, (2) avaliar orquestradores manuais por domínio, (3) execução em blocos inspirada no deepseek-harness, (4) parametrizar governança de modelo por ação, (5) formalizar os três pilares de entrega. Este documento cobre os cinco, referenciando os anteriores em vez de repetir o que já foi fechado.

---

### 1. Skills atualizadas — referências modernas de 2026

Notas de atualização por pack (Parte III, seção 2). Não substitui o conteúdo já proposto, adiciona o que mudou de concreto neste ano.

#### `backend-web/` — Laravel

| Atualização | Ação na skill |
|---|---|
| Laravel 12/13 são as versões ativamente suportadas em 2026, mirando PHP 8.3–8.5; suporte de segurança da 13 vai até 2028 | `laravel-patterns` passa a recusar (avisar, não bloquear sozinho) projeto em Laravel <11, fora do ciclo de segurança |
| Controller fino + service class por operação de negócio é consenso consolidado, não sugestão | Já estava no seu uso real — formalizar como regra em `laravel-patterns`, candidata natural a regra inegociável se aparecer quebrado 3x |
| Erro mais citado em produção: cache com tag sem invalidação escrita no mesmo commit | Adicionar como item explícito de checklist em `laravel-verification` |
| Deploy atômico (release timestampada, symlink só depois de tudo pronto) é o padrão 2026 pra evitar downtime | Vira o default de `deployment-patterns` pro seu stack |
| Auditoria de dado + criptografia de PII em nível de banco por exigência de compliance (GDPR e equivalentes) | `laravel-security` ganha seção específica — relevante porque CashBarber lida com dado de cliente |

#### `frontend-web/`

| Atualização | Ação na skill |
|---|---|
| React Server Components é padrão de produção em 2026, não mais experimental; React Compiler torna `useMemo`/`useCallback` manual a exceção | `frontend-patterns` passa a orientar "não hardcode memoização, escreva componente puro, deixe o compiler decidir" |
| Estado local por padrão ("Atomic State"), Context só pra dado estático global (auth/tema), Zustand/TanStack Query pro resto | Atualiza a orientação de state management — nunca mais "uma store global" |
| Islands/hidratação parcial é o padrão de performance | Adiciona como critério em `frontend-patterns` |
| Core Web Vitals viraram meta objetiva (INP ≤200ms p75, LCP ≤2.5s, CLS ≤0.1) | Isso é ótimo pra virar **gate determinístico** dentro de `seo-technical` — número medido, não "parece rápido" |

#### `mobile/`

| Atualização | Ação na skill |
|---|---|
| Swift 6.3 (mar/2026) lançou SDK oficial de Android — Swift deixou de ser só-Apple | Registrar como opção real em `swift-concurrency` se algum dia fizer sentido código mobile compartilhado |
| Kotlin 2.3.x com interop nativo melhor e suporte a Java 25 | Atualiza versão de referência em `kotlin-patterns` |
| Concorrência estruturada (Swift Concurrency 6.2, Coroutines) é padrão obrigatório, não mais opcional | Reforça em ambas as skills |

#### `games-multiplatform/` — a atualização mais importante deste pack

| Atualização | Ação na skill |
|---|---|
| Unity segue dominante em mobile (~48% share, ~70% dos top-grossing) e tem o toolchain de profiling mais maduro pra mobile | `game-engine-unity-csharp` continua sendo o default recomendado pra jogo mobile |
| Unreal lidera em receita/AAA; sistema de replicação é "o benchmark" pra jogo competitivo rápido | Mantém `game-engine-unreal-cpp` como recomendação pra esse caso específico |
| **Godot não tem client-side prediction/rollback nativo, nem lobby/matchmaking embutido** — é limitação real e documentada em 2026, não FUD | **Correção importante em `netcode-multiplayer-patterns`**: alertar explicitamente que Godot sozinho não serve pra netcode competitivo — precisa de solução externa. Escolher Godot pra esse caso sem saber disso é decisão de arquitetura errada logo na largada |
| Unity 6 amadureceu Netcode for GameObjects/Entities | `netcode-multiplayer-patterns` recomenda isso como primeira opção dentro de Unity |

#### `systems-languages/`

| Atualização | Ação na skill |
|---|---|
| Go continua o default pragmático pra ~80% dos casos backend/cloud-native (produtividade, contratação, ecossistema) | Faltava um **critério de decisão explícito** — adicionar a `go-patterns`: "use Go por padrão" |
| Rust vale a troca só quando o requisito é memória/latência determinística ou desempenho crítico (motor de jogo, processamento de pacote de rede) | Adicionar a `rust-patterns` como critério de quando trocar, não deixar a IA escolher por hábito |
| Go 1.24 (fev/2026) melhorou o scheduler de goroutine; Rust 1.93 é o estável atual | Atualiza versão de referência nas duas skills |

#### `devops-deploy/`

| Atualização | Ação na skill |
|---|---|
| Platform engineering (plataforma interna self-service) é a tendência dominante de 2026 | Vale desenhar `deployment-patterns` já pensando nisso, se o hii algum dia atender múltiplos projetos/times |
| Trunk-based development + shift-left security (scanner dentro do CI, não só no fim) | Bate direto com a Fase 7 do hii (Parte III) — reforça que o checklist de segurança deveria rodar cedo, não só perto do merge |
| GitOps para infraestrutura declarativa | Documentar como padrão default se o CashBarber for pra Kubernetes; sem prioridade imediata se o deploy ainda é mais simples |

---

### 2. Orquestradores manuais por domínio — é boa ideia?

**Sim — com uma correção de enquadramento antes de colocar no plano.**

Três razões concretas pra ser boa ideia:

1. **Problema do bootstrap.** A detecção automática por diff (Parte III, seção 2) só funciona quando já existe algo no repositório pra detectar. Num projeto novo ou numa feature greenfield, não há arquivo `.csproj`/`project.godot`/`composer.json` ainda — não tem o que detectar. Comando manual resolve exatamente esse buraco.
2. **Override explícito em caso ambíguo.** Às vezes um arquivo (ex: um `.json` de configuração) poderia pertencer a mais de um domínio. Comando manual remove a ambiguidade sem precisar de heurística mais complexa no core.
3. **Ergonomia real.** Você já pensa em termos de "agora vou fazer uma tarefa de jogo" — ter um comando que expressa essa intenção de cara é mais rápido que confiar 100% em detecção e torcer pra acertar.

**A correção de enquadramento:** eles não são orquestradores novos — são **atalhos de intake**. Cada `/orquestrador-<domínio>` é sintaticamente um comando, mas semanticamente só pré-carrega um `RoleLoadout` + lista de `skillPacks` (Parte III, seções 2 e 3) pro card que está sendo criado. O card que sai de `/orquestrador-jogos` passa pelo mesmíssimo pipeline, mesmíssimos gates, mesmíssimo `core/` de sempre — nada muda na camada que decide o ciclo de vida, só muda o que é carregado nela.

```ts
// core/commands.ts
interface ComandoManual {
  comando: string;                       // ex: '/orquestrador-jogos'
  skillPacksPadrao: string[];            // ex: ['common', 'games-multiplatform']
  roleLoadoutPadrao?: Partial<RoleLoadout>;
  fasePlanoPadrao: 'layout' | 'padrao';  // ver seção 2.1
}

const comandos: ComandoManual[] = [
  { comando: '/orquestrador-jogos',    skillPacksPadrao: ['common', 'games-multiplatform'], fasePlanoPadrao: 'layout' },
  { comando: '/orquestrador-dev-web',  skillPacksPadrao: ['common', 'backend-web', 'frontend-web'], fasePlanoPadrao: 'layout' },
  { comando: '/orquestrador-android',  skillPacksPadrao: ['common', 'mobile'], fasePlanoPadrao: 'layout' },
  { comando: '/orquestrador-devops',   skillPacksPadrao: ['common', 'devops-deploy'], fasePlanoPadrao: 'layout' },
];
```

Detecção automática pelo diff continua sendo o caminho padrão. O comando manual é **override explícito**, não substituição — os dois convivem, o manual só vence quando presente.

#### 2.1 `/layout` como método majoritário da Fase 3

Os comandos acima definem o *conteúdo* (qual skill pack ativo). `/layout` continua sendo o *método* — e deve ser o método dominante de entrada na Fase 3 (Plano) do Parte III, na maioria dos casos. Produz, antes de qualquer código, um artefato de estrutura: layout de tela (web/mobile), contrato de API, schema de dado, ou estrutura de cena/nível (jogos) — dependendo de qual skill pack está ativo. É a aplicação prática direta do Pilar 1 (seção 5): não se toca em código sem ter a estrutura definida primeiro.

Na prática: `/orquestrador-jogos` + `/layout` juntos significam "abrir card de jogo, começar pelo layout de cena/nível antes de qualquer script" — o primeiro escolhe o quê, o segundo escolhe o como planejar.

---

### 3. Execução em blocos com sinalizador de conclusão

Fui direto na fonte antes de desenhar isso — vale separar o que o deepseek-harness realmente faz do padrão genérico que você descreveu, porque são duas técnicas diferentes e a mais valiosa das duas não é a mais óbvia.

#### O que o dsh realmente faz (e é o de maior impacto)

O harness **nunca edita tokens já enviados** — o histórico é append-only, e uma correção vira uma linha nova dizendo "aquilo estava errado", nunca uma reescrita do que já foi mandado. Isso mantém um **prefixo de prompt estável** entre chamadas dentro da mesma sessão, o que ativa cache de prefixo do lado do provedor — a própria DeepSeek documenta até **30x de desconto** em tokens de entrada cacheados quando o prefixo bate byte a byte com a chamada anterior.

Isso não é uma técnica nova pro hii — é o mesmo princípio do ledger append-only já recomendado (Parte I, seção 3.7), só que agora com número concreto de retorno, e com uma condição extra que faltava explicitar: **o prefixo precisa ser byte-idêntico entre chamadas pra valer**, o que muda como o `repair-loop` deveria montar prompt.

#### O padrão "bloco + `[DONE]`" que você descreveu

Isso é o formato de streaming padrão de APIs tipo OpenAI/DeepSeek — a resposta chega em pedaços via SSE e termina com uma linha sentinela (`data: [DONE]`) sinalizando fim de stream, pra quem está lendo saber exatamente quando parar sem precisar bufferizar a resposta inteira antes de agir. Não é exclusivo do dsh, é convenção de mercado — mas é genuinamente útil, só que resolve um problema diferente do prefixo estável.

#### Como aplicar os dois no hii — sem dependência nova, é protocolo, não biblioteca

**3.1 Prefixo estável por card (o ganho de custo real)**

Toda invocação de harness dentro do mesmo card monta o prompt como prefixo fixo (system + skills carregadas + histórico da sessão) + sufixo pequeno (a instrução nova). O `repair-loop` (Parte III, seção 4) é o lugar certo pra isso: cada `narrowFix` deveria **anexar**, nunca reescrever o prompt inteiro — é condição necessária pro cache de prefixo funcionar do lado do provedor.

**3.2 Blocos com conclusão explícita pra tarefas grandes (evita desperdiçar geração ruim)**

Quando o `implementador` recebe uma tarefa que cruza múltiplos arquivos/camadas, o `core/agent-executor.ts` (Parte III, seção 3.1) fatia em blocos (ex: schema → migration → model → controller → teste) e exige um marcador determinístico de conclusão por bloco antes de liberar o próximo:

```ts
// core/block-executor.ts
interface Bloco {
  id: string;
  instrucao: string;          // sufixo pequeno — nunca reescreve o prefixo já enviado (3.1)
  validar: (ctx: GateContext) => Promise<GateVerdict>;
}

async function executarEmBlocos(blocos: Bloco[], harness: Harness, prefixoEstavel: string) {
  for (const bloco of blocos) {
    const resultado = await harness.invoke({ prompt: `${prefixoEstavel}\n${bloco.instrucao}`, ... });
    const verdict = await bloco.validar(resultado.contexto);
    if (verdict.status !== 'ok') {
      return { pararEm: bloco.id, verdict }; // não desperdiça os blocos seguintes numa base já quebrada
    }
  }
  return { concluido: true };
}
```

O ganho de custo de verdade vem de 3.1 (prefixo estável = cache de prefixo). O ganho de "não pagar por geração desperdiçada" vem de 3.2 (parar cedo num bloco ruim, em vez de gerar a tarefa inteira pra descobrir só no fim que a base tava errada). Os dois juntos fecham o pedido, mas por motivos diferentes — vale manter essa distinção clara no código também: `prefixoEstavel` é uma preocupação de custo, `Bloco.validar` é uma preocupação de qualidade.

---

### 4. Governança de modelo por ação — parametrização

O Parte III (seção 8) já propunha `config/model-tier.json`. Aqui vai a parametrização mais rigorosa que você pediu, com os números que sustentam cada decisão:

| Achado de mercado (2026) | O que isso significa pro hii |
|---|---|
| Diferencial de custo entre tier premium e tier pequeno é de **100–300x** | É a alavanca real — vale medir antes de decidir tier por hábito |
| Roteamento bem calibrado corta custo **40–85%** sem perda perceptível — mas só quando o classificador de complexidade é bom | Se o classificador erra pra baixo, a economia "evapora em retry, escalonamento e regressão silenciosa de qualidade" — é o mesmo risco que a guarda de risco (Parte I, 3.6) já mitiga pros perfis `enxuto/completo`; deve ser **a mesma guarda**, reaplicada a tier de modelo |
| Roteamento determinístico (regex/keyword) custa <1ms; classificador semântico custa 50-100ms | Desprezível frente à latência da chamada em si (500-2000ms) — não tem desculpa pra rotear sem calcular direito |
| Trilha de auditoria/explicabilidade é exigência crescente de governança em produção | Já resolvido pelo ledger do hii — só falta formalizar o evento `model_tier_selected` com o motivo |

Parametrização expandida:

```json
// config/model-tier.json
{
  "criterios": {
    "arquitetura":     { "tier": "tier1_caro",   "motivo": "decisão difícil de reverter, custo de erro alto" },
    "seguranca":       { "tier": "tier1_caro",   "motivo": "custo de falso negativo é maior que custo de token" },
    "implementacao":   { "tier": "tier2_padrao", "motivo": "volume alto, tarefa bem especificada pelo plano" },
    "reparo_build":    { "tier": "tier2_padrao", "motivo": "escopo estreito por narrowFix" },
    "documentacao":    { "tier": "tier3_barato", "motivo": "baixo risco de erro caro" },
    "cleanup":         { "tier": "tier3_barato", "motivo": "baixo risco de erro caro" }
  },
  "regraDeSubida": "card ou regra-inegociavel (Parte III, seção 6) pode forçar tier acima do padrão, nunca abaixo",
  "orcamentoPorCard": { "tetoUsd": 5, "acaoAoEstourar": "pausar e notificar humano" }
}
```

`orcamentoPorCard` é o item novo que faltava: teto de gasto por card, lido do mesmo ledger que já existe, pra pegar o caso onde um repair-loop preso consome custo demais mesmo estando dentro do limite de tentativas.

---

### 5. Pilares de entrega — formalizados e amarrados às fases existentes

Os três pilares não são princípios soltos — cada um reforça uma fase específica da cadeia (Parte III, seção 1).

#### Pilar 1 — Não tocar código sem 95% de entendimento

"95%" não pode ser autorrelato do modelo — é exatamente o motivo pelo qual nenhum gate técnico do hii aceita "o modelo disse que passou" (princípio central de todo este projeto). Em vez de um número, uma **matriz de entendimento** vira artefato obrigatório antes de sair da Fase 4 (Confirmação humana do plano):

```
matriz-entendimento-<card>.md
- Requisito confirmado (linha a linha do pedido original)
- Contrato de entrada esperado
- Contrato de saída esperado
- Casos de borda identificados
- Dependência/risco identificado
- Definição de pronto
```

Só avança pra Fase 5 quando essa matriz existe **e** um humano confirma (a parede da Fase 4 já existia — isso só dá conteúdo concreto pra ela checar). "95% de entendimento" vira "toda linha da matriz preenchida e confirmada", não uma métrica que o próprio modelo inventa sobre si mesmo.

#### Pilar 2 — Validar de forma automatizada, com cenários de entrada e saída

Formaliza, dentro da Fase 5 (TDD) e Fase 8 (avaliador), uma matriz de cenário obrigatória por feature — isso é o que o RED do TDD (já recomendado no catálogo) precisa cobrir, não "um teste qualquer que falha":

| Cenário | Obrigatório? |
|---|---|
| Caminho de acerto (happy path) | Sempre |
| Caminho de erro conhecido | Sempre |
| Caminho alternativo/borda | Sempre que a matriz de entendimento (Pilar 1) tiver identificado um |
| Validação de entrada | Sempre |
| Validação de saída | Sempre |

O `avaliador` (papel formal, Parte I, seção 3.5) reprova se a matriz não estiver coberta — vira parte do critério escrito em `config/review-criteria.json`, não julgamento solto.

#### Pilar 3 — Setup ferramental (testes e debug) no momento da criação

Quando a Fase 1 (Intake) detecta que o card abre um projeto ou área de feature nova — não é ajuste em código existente — o pipeline não avança pra Fase 3 até existirem: configuração de teste (framework já rodando, com pelo menos 1 teste trivial passando) e configuração de debug (logging estruturado mínimo, ponto de entrada de debug documentado). É uma pré-condição determinística, checável em disco (existe config de teste? roda sem erro?) — mesma filosofia de todos os outros gates do hii, só que aplicada antes do código começar a existir, não depois.

---

### 6. Roadmap — itens novos desta conversa

Continuando a numeração dos documentos anteriores:

| Ordem | Item | Fecha |
|---|---|---|
| 15 | Notas de referência 2026 aplicadas em cada `SKILL.md` (seção 1 aqui) | Atualização de conteúdo, sem mudança de motor |
| 16 | `core/commands.ts` com os 4 comandos manuais + `/layout` como método padrão de Fase 3 | Resolve o bootstrap de projeto/feature greenfield |
| 17 | Prompt de prefixo estável no `repair-loop` (nunca reescrever, só anexar) | Ativa cache de prefixo — ganho de custo mensurável (até 30x em input cacheado) |
| 18 | `core/block-executor.ts` — blocos com validação incremental | Evita pagar por geração inteira desperdiçada numa base já quebrada |
| 19 | `config/model-tier.json` expandido + `orcamentoPorCard` no ledger | Governança de custo por ação, auditável |
| 20 | `matriz-entendimento-<card>.md` obrigatória na Fase 4 | Pilar 1 — vira critério checável, não confiança cega |
| 21 | Matriz de cenário (acerto/erro/alternativo/entrada/saída) no `config/review-criteria.json` | Pilar 2 |
| 22 | Guarda determinística de setup ferramental na Fase 1 pra projeto/feature nova | Pilar 3 |
| 23 | Modo `gauntlet` no `crivo` (referência externa + comparação cega) pra `frontend-web`/`games-multiplatform` | Parte I, seção 3.5 — avaliação subjetiva sem virar autoavaliação |
| 24 | `config/topologia.json` — grafo declarado como dado, não como motor | Parte I, seção 3.9 — auditabilidade sem custo de motor de grafo |

Os itens 16-18 são os que mais mudam o dia a dia de uso — 16 resolve o problema real de começar do zero, 17-18 são economia de token mensurável e não teórica, já que vieram de número publicado, não estimativa. Os itens 23-24 fecham a checagem desta conversa: Gauntlet Loop tinha uma peça real faltando (referência externa), Graph Engineering não — a cautela já registrada contra grafo livre bateu com o que o mercado está dizendo agora, então o item 24 é a única fatia barata que vale pegar dali.


---

## Parte VI — Confiabilidade de Produção e Multi-Nuvem

Até aqui os documentos cobriram a **qualidade do que o hii entrega** (gates, skills, aprendizado, avaliação). Este cobre a **confiabilidade do motor em si** — o que falta pra ele rodar sem supervisão constante numa VPS ou em qualquer uma das três nuvens, sobrevivendo a crash, restart e deploy sem perder trabalho nem duplicar efeito colateral.

### 0. Calibrar o problema antes de resolver

A pesquisa de 2026 sobre runtime de agente de longa duração dá um framework de decisão por duração que vale aplicar ao hii antes de desenhar qualquer coisa:

| Duração da unidade de trabalho | O que a literatura recomenda |
|---|---|
| <30s, idempotente | SDK simples no ciclo de vida da requisição |
| 30s–60min, sem necessidade de recovery | fila + worker + banco de checkpoint |
| 60min–24h | mesma fila + worker, ou job de execução única |
| >24h, precisa sobreviver a deploy | motor de execução durável (estilo Temporal) |

Uma fase isolada do hii (um gate, um repair-loop) fica na faixa de minutos. Mas um **card inteiro** — contando o tempo parado esperando confirmação humana do plano ou aprovação de PR — pode ficar aberto por horas ou dias. Isso empurra o hii pra fora da faixa "fila + worker" e pra dentro da faixa que pediria um motor de execução durável de verdade.

**A decisão que este documento toma:** não adotar Temporal nem equivalente. Não por dogma contra dependência — é porque o próprio material de 2026 que documenta esse problema (seção 3.9 do Parte I, achado do ChromaFlow) também mostra que adicionar máquina de recuperação além do necessário **degrada acurácia e aumenta ruído operacional** em vez de ajudar. No porte atual do hii (um operador, cards não concorrentes em volume alto), dá pra pegar os *princípios* de execução durável — checkpoint, idempotência, jornal de execução — sem pegar o motor. Se o hii um dia rodar múltiplas organizações com SLA de disponibilidade formal, essa decisão deveria ser revisitada — não antes disso.

---

### 1. Idempotência de efeito colateral — a peça que mais falta hoje

Esta é a lacuna mais séria que apareceu na pesquisa e não estava em nenhuma parte anterior: **se uma chamada de harness tem efeito colateral real (commit, abertura de PR, webhook, notificação) e o processo do hii cai antes de salvar que aquilo aconteceu, um retry ingênuo duplica o efeito.** Isso já é dor conhecida de sistema distribuído há décadas — agente de IA não é exceção.

```ts
// core/idempotency.ts
interface OperacaoComEfeito {
  chaveIdempotencia: string;   // determinística: hash(card + fase + tipo_operacao)
  executar: () => Promise<unknown>;
}

async function executarComIdempotencia(op: OperacaoComEfeito): Promise<unknown> {
  const jaExecutada = await ledger.buscarPorChave(op.chaveIdempotencia);
  if (jaExecutada) return jaExecutada.resultado; // não repete o efeito, devolve o resultado gravado

  const resultado = await op.executar();
  await ledger.gravar(op.chaveIdempotencia, resultado); // grava ANTES de considerar a operação concluída
  return resultado;
}
```

Regra prática: toda operação que fala com o mundo fora do processo do hii — `git commit`, abrir PR, disparar webhook, notificar humano, gravar linha de custo — passa por aqui. Operação só de leitura (rodar teste, ler diff) não precisa, porque repetir não tem custo de duplicação.

---

### 2. Checkpoint e retomada — o ledger vira o diário de execução

O ledger append-only (Parte I, seção 3.8) já registra evento por fase. Falta uma peça: no restart do processo do hii, ele precisa **reconstruir onde cada card em andamento parou**, lendo o próprio ledger, em vez de assumir que tudo precisa recomeçar do zero.

```ts
// core/recovery.ts
async function retomarAoIniciar() {
  const cardsAbertos = await lerCardsSemEventoFinal(); // qualquer card sem 'card_fechado' no ledger
  for (const card of cardsAbertos) {
    const ultimoEvento = await ultimoEventoDoCard(card.id);
    // reconstrói a fase exata (ex: 'gate_start' sem 'gate_verdict' correspondente = gate estava rodando)
    await retomarNaFase(card, ultimoEvento);
  }
}
```

Ponto que a pesquisa marca como o erro mais comum: se o checkpoint não existir ou estiver velho, a recuperação degrada pra "reler o log inteiro do zero", que é lento e caro em token. Isso reforça um ponto que já estava certo desde o primeiro documento — o ledger por evento (não só por chamada de IA) é exatamente o que evita essa degradação, contanto que cada transição de estado do pipeline grave um evento correspondente sem falta.

---

### 3. Compensação de falha parcial (padrão saga)

Nem toda operação do hii tem rollback transacional — não existe "desfazer" um PR aberto do jeito que existe um `ROLLBACK` de banco. Onde isso importa, precisa de uma ação de compensação explícita, ou, no mínimo, o estado precisa ficar marcado como órfão pra revisão humana em vez de silenciosamente ignorado.

| Situação | Compensação |
|---|---|
| Worktree criado, card cai antes de qualquer commit | Sem ação — retomar normalmente (seção 2), worktree é descartável |
| Commit feito, card cai antes do PR abrir | Retomar e abrir o PR — commit sozinho não é efeito visível externamente |
| PR aberto, card cai antes da Fase 11 (parede humana) fechar | **Marcar como `pr_orfao` no ledger** — não abrir um segundo PR no retry, sinalizar pro humano revisar o que já existe |
| Webhook/notificação disparada, ledger não confirmou gravação | Reenviar é seguro só se o webhook em si carregar a chave de idempotência (seção 1) — do contrário, marcar como `notificacao_incerta` e deixar pro humano confirmar |

Isso não pede biblioteca nenhuma — é o mesmo ledger de sempre, só com uma categoria de evento (`orfao`) que o `aprendiz` (Parte III, seção 6) também pode usar como sinal de problema recorrente, se o mesmo tipo de órfão aparecer demais.

---

### 4. Portabilidade cloud-agnostic — a lição mais clara da pesquisa

Os serviços gerenciados de agente de cada nuvem (AWS AgentCore, GCP Agent Engine) vêm com aviso explícito de quem os documenta: uma vez que você amarra o motor em IAM/VPC/storage específico de uma nuvem, mover pra outra é reescrita significativa. Isso confirma o caminho que o hii já vinha seguindo por outro motivo (zero dependência de terceiros) — aqui ele também é o caminho certo pra portabilidade de infraestrutura.

**Desenho proposto:**

```dockerfile
# Dockerfile — uma imagem, roda igual em VPS/AWS/Azure/GCP
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
# Nenhuma dependência de SDK de nuvem específica no core
ENTRYPOINT ["node", "core/main.js"]
```

- **Configuração via variável de ambiente** (12-factor), nunca arquivo de config amarrado a um provedor.
- **Estado persistido em volume externo ao container** (worktrees, ledger, `.hii/`, `skills/`) — em VPS isso é um disco montado; em qualquer nuvem isso é o volume/bucket equivalente, mas o hii não sabe nem precisa saber qual.
- **Sem serviço gerenciado de nuvem como dependência obrigatória.** O hii fala HTTP com as APIs das IAs (claude/codex/kimi/qwen) e nada mais — isso já é portável por definição, contanto que nenhum código novo comece a assumir IAM da AWS ou Key Vault do Azure como pré-requisito.
- **`docker-compose.yml` cobre o caso VPS**; o mesmo `Dockerfile` sobe como container service em qualquer uma das três nuvens sem mudança — a diferença fica inteira na camada de infra (rede, volume, DNS), nunca no código do hii.

---

### 5. Gestão de segredos — adaptador, não dependência obrigatória

O hii precisa de chave de API pra cada harness (`claude`, `codex`, `kimi`, `qwen`). Regra: **variável de ambiente é o caminho padrão e obrigatório de funcionar em qualquer lugar**; integração com cofre de segredo de nuvem específico (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager) é opcional, plugável, nunca hard-requirement:

```ts
// core/secrets.ts
interface SecretProvider {
  get(nome: string): Promise<string>;
}

class EnvSecretProvider implements SecretProvider {
  async get(nome: string) { return process.env[nome] ?? throwFaltaSegredo(nome); }
}
// AwsSecretProvider, AzureSecretProvider, GcpSecretProvider — cada um opcional,
// implementados só se e quando o deploy específico pedir; EnvSecretProvider
// nunca deixa de funcionar sozinho numa VPS crua.
```

Isso resolve o pedido de rodar em qualquer um dos quatro ambientes sem forçar o hii a "escolher um lado" de nuvem.

---

### 6. Observabilidade de infraestrutura (diferente da observabilidade de IA)

O ledger (Parte I, 3.8) já cobre observabilidade *de decisão de IA*. Falta a camada de infraestrutura, que é mais simples e não pede nada novo:

- **Health check** — endpoint HTTP simples (`GET /health`) respondendo se o processo está de pé e se a fila está processando, pra qualquer orquestrador de container (systemd, Docker restart policy, load balancer de qualquer nuvem) saber quando reiniciar.
- **Shutdown gracioso** — ao receber `SIGTERM`, o hii para de aceitar cards novos, espera o bloco/gate em andamento terminar (Parte V, seção 3.2 — `Bloco.validar` já dá um ponto de parada natural), grava o checkpoint, só então encerra. Sem isso, todo deploy vira um crash não-gracioso que a seção 2 precisa cobrir de qualquer jeito, mas cobrir por acidente é pior que cobrir por design.
- **Log estruturado** — o ledger já é JSON por linha; isso já é o formato que qualquer agregador de log de qualquer nuvem consome sem adaptação.

---

### 7. Backup e recuperação de desastre

O que precisa sobreviver a perda de VM/VPS:

| Dado | Por quê importa | Estratégia mínima |
|---|---|---|
| Ledger (JSONL) | É o checkpoint de retomada (seção 2) — perder ele é perder a capacidade de recuperar cards em andamento | Snapshot/rsync do volume em intervalo curto (ex: a cada 15min) |
| `config/regras-inegociaveis.json` | Aprendizado acumulado (Parte III, seção 6) — perder é regredir qualidade silenciosamente | Versionado em git, não só no disco da VM |
| `skills/` (`_native` e `_sources`) | Conteúdo curado, caro de reconstruir | Já deveria estar em git por natureza — reforçar que nunca fica só no disco de produção |
| Worktrees em andamento | Recuperável a partir do ledger + repo remoto, não crítico | Sem backup dedicado — retomar via seção 2 é suficiente |

Não precisa de solução cara nesse porte — volume com snapshot automático (qualquer VPS/nuvem oferece isso nativamente) mais o que já está em git cobre o essencial.

---

### 8. Isolamento de recursos entre cards paralelos

O Parte III (seção 9) já recomenda N cards em paralelo via worktree. Em produção, isso precisa de teto de CPU/memória/disco por worktree — senão um card com repair-loop preso consome recurso do host e derruba os outros:

```yaml
# docker-compose.yml (trecho) — mesmo efeito via limite de container em qualquer nuvem
services:
  hii-worker:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 2G
```

Mesmo princípio de `orcamentoPorCard` (Parte V, seção 4) — lá é teto de custo de token, aqui é teto de recurso de máquina. Os dois existem pelo mesmo motivo: um card com problema não pode consumir recurso ilimitado só porque ainda não bateu o teto de tentativa do repair-loop.

---

### 9. Roadmap — confiabilidade de produção

| Ordem | Item | Fecha |
|---|---|---|
| 25 | `core/idempotency.ts` em toda operação com efeito colateral externo | Seção 1 — a lacuna mais séria encontrada nesta rodada |
| 26 | `core/recovery.ts` — retomada de card a partir do ledger no restart | Seção 2 |
| 27 | Categoria de evento `orfao` no ledger + compensação por tipo de operação | Seção 3 |
| 28 | `Dockerfile` + `docker-compose.yml` únicos, sem SDK de nuvem no core | Seção 4 |
| 29 | `core/secrets.ts` com `EnvSecretProvider` como caminho sempre-funcional | Seção 5 |
| 30 | `GET /health` + shutdown gracioso em `SIGTERM` | Seção 6 |
| 31 | Snapshot automático do volume (ledger, worktrees) + `skills/`/regras sempre em git | Seção 7 |
| 32 | Limite de CPU/memória por worktree em paralelo | Seção 8 |

Prioridade real, se for pra escolher por onde começar: **25 e 26 primeiro.** São os dois que decidem se um crash no meio de um card vira "retoma sozinho de onde parou" ou "abre PR duplicado e ninguém percebe até o cliente reclamar". Todo o resto desta lista é robustez incremental; esses dois são a diferença entre "roda numa VPS que você reinicia manualmente quando algo trava" e "roda em produção de verdade".


---

## Parte VII — Roadmap Consolidado (visão única, itens 1–32)

Os itens abaixo já estão numerados de forma contínua nas Partes III, V e VI — esta seção só reúne as três tabelas num único lugar pra consulta rápida, sem repetir a discussão de cada item (ver a parte de origem indicada).

| Ordem | Item | Fecha | Parte de origem |
|---|---|---|---|
| 1 | Harness interface formal | pré-requisito de tudo | I / III |
| 2 | Guarda determinística de risco sobre o diff | Fase 1 | I / III |
| 3 | `search-first` como skill de `common/` | Fase 2 | III |
| 4 | Confirmação humana do plano antes de implementar | Fase 4 | III |
| 5 | RED antes de GREEN obrigatório no perfil `completo` | Fase 5 | III |
| 6 | Registro de `BuildRepairer` por domínio, começando por Laravel | Fase 6 | III |
| 7 | Checklist de segurança versionado por stack | Fase 7 | III |
| 8 | Critério escrito pro `crivo` + Camada 1-2 do `plugin-eval` | Fase 8 | III |
| 9 | `doc-updater` como papel novo | Fase 9 | III |
| 10 | Pack `games-multiplatform/` | Fase 10 | III |
| 11 | `core/agent-executor.ts` — despacho dinâmico dentro de uma fase | Orchestrator-Workers sem motor novo | III |
| 12 | Papel `aprendiz` + `.hii/candidatos-regras/` com limiar de promoção | Fase 12, parte macia | III |
| 13 | `config/regras-inegociaveis.json` + `core/rule-guard.ts` | Fase 12, parte dura | III |
| 14 | Auditoria do próprio harness (`auditoria_harness`) | Segurança meta | III |
| 15 | Notas de referência 2026 em cada `SKILL.md` | Atualização de conteúdo | V |
| 16 | `core/commands.ts` — comandos manuais + `/layout` como método padrão da Fase 3 | Bootstrap de projeto/feature greenfield | V |
| 17 | Prefixo estável no `repair-loop` (anexar, nunca reescrever) | Cache de prefixo — até 30x mais barato em input cacheado | V |
| 18 | `core/block-executor.ts` — blocos com validação incremental | Evita geração desperdiçada | V |
| 19 | `config/model-tier.json` expandido + `orcamentoPorCard` no ledger | Governança de custo por ação | V |
| 20 | `matriz-entendimento-<card>.md` obrigatória na Fase 4 | Pilar 1 | V |
| 21 | Matriz de cenário no `config/review-criteria.json` | Pilar 2 | V |
| 22 | Guarda determinística de setup ferramental na Fase 1 | Pilar 3 | V |
| 23 | Modo `gauntlet` no `crivo` (referência externa + comparação cega) | Avaliação subjetiva sem autoavaliação | V |
| 24 | `config/topologia.json` — grafo declarado como dado | Auditabilidade sem motor de grafo | V |
| 25 | `core/idempotency.ts` em toda operação com efeito colateral externo | Maior lacuna de confiabilidade encontrada | VI |
| 26 | `core/recovery.ts` — retomada de card a partir do ledger no restart | Sobrevive a crash sem duplicar trabalho | VI |
| 27 | Categoria de evento `orfao` no ledger + compensação por tipo de operação | Falha parcial (padrão saga) | VI |
| 28 | `Dockerfile` + `docker-compose.yml` únicos, sem SDK de nuvem no core | Portabilidade VPS/AWS/Azure/GCP | VI |
| 29 | `core/secrets.ts` com `EnvSecretProvider` como caminho sempre-funcional | Segredos portáveis | VI |
| 30 | `GET /health` + shutdown gracioso em `SIGTERM` | Observabilidade de infraestrutura | VI |
| 31 | Snapshot automático do volume + `skills/`/regras sempre em git | Backup e disaster recovery | VI |
| 32 | Limite de CPU/memória por worktree em paralelo | Isolamento de recurso | VI |

**Se for pra escolher só alguns pra começar:** 1-2 (base de tudo), 17-18 (economia de custo mensurável), 25-26 (a diferença entre rodar numa VPS supervisionada manualmente e rodar em produção de verdade).
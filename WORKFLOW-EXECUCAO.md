# 🇧🇷 WORKFLOW DE EXECUÇÃO — modernização do motor `hii`

Ordem de construção dos 32 itens do `MODERNIZATION.md` sob a taxonomia de `ARQUITETURA-BRAZIL.md`.

Este documento é operacional: cada onda tem escopo fechado, arquivos nomeados, **gate de saída verificável em disco** e critério de parada. Ler junto com:

- **`ARQUITETURA-BRAZIL.md`** — o que é cada código e onde mora
- **`MODERNIZATION.md`** — a justificativa técnica de cada item
- **`brazil-orchestrator-naming.md`** — a taxonomia de origem

---

## 0. Regras do workflow

Estas regras valem em **todas** as ondas. Violar qualquer uma reprova a onda, mesmo com o gate técnico verde.

| # | Regra | Por quê |
|---|---|---|
| R1 | **O gate fecha por exit code em disco.** Nenhuma onda fecha porque "o modelo disse que passou" | É o princípio central do motor. Modernizar não pode relaxá-lo |
| R2 | **`bun run test` verde ao fim de cada commit**, não só ao fim da onda. Reprovação só conta como defeito se **reproduzir numa segunda rodada** — existe um flake conhecido de isolamento entre arquivos de teste (ver `PENDENCIAS.md`). Não reproduziu: registre e siga | Bisect só funciona se todo commit for verde — e um flake não distinguido transforma o gate em ruído |
| R3 | **Uma onda, um tema.** Rename não anda junto com feature. Feature não anda junto com refactor | Diff misto é diff que ninguém revisa de verdade |
| R4 | **Comportamento observável só muda em onda de feature.** Onda 1 é 100% mecânica | Se a Onda 1 mudar comportamento, o rename deixa de ser verificável |
| R5 | **Nada vira "modo" novo** | Sprawl de modos é o modo de falha nº 1 documentado (MODERNIZATION Parte III, Princípio 1) |
| R6 | **Ordem é dependência, não preferência.** Onda N só começa com o gate de N-1 fechado | As dependências abaixo são reais, não estéticas |
| R7 | **Onda que estourar o escopo para e vira duas.** Nunca alarga a onda em andamento | Mesma disciplina do repair-loop: teto, não loop aberto |
| R8 | **Rename de símbolo (`ARQUITETURA-BRAZIL.md` §6) anda junto com a onda que já mexe naquele arquivo**, nunca sozinho | A Onda 1 renomeou arquivos, não símbolos. Fazer os símbolos numa onda própria seria um segundo diff cego pelo repositório inteiro; fazê-los onde a feature já está tocando o código é revisável |

### Gate de saída padrão

Toda onda fecha com, no mínimo:

```bash
bun run test        # typecheck + lint:types + lint:clone + 151 suítes
```

Ondas de feature acrescentam gates próprios, listados em cada seção.

---

## 1. Mapa das ondas

| Onda | Tema | Itens | Dono principal | Muda comportamento? | Estado |
|---|---|---|---|---|---|
| **0** | Rede de segurança | — | — | Não | ✅ feita |
| **1** | Rename estrutural BRAZIL | — | todos | Não (mecânico) | ✅ feita |
| **2** | Fundação plugável | 1 (parcial), 24, §3.7 | TMD, NMY | Pouco | ✅ feita |
| **2b** | Descritor completo do harness | 1 (resto) | TMD | Pouco | ✅ feita |
| **3** | Sobrevivência | 25, 26, 27, 30 | SLV, EUC, RDR | Sim | ✅ feita |
| **4** | Autoresolução | 6, 17, 18, §3.2 | CIC, RPR, ECO, TJL | Sim | ✅ feita |
| **5** | Rigor determinístico | 2, 5, 8, 13, 21, 22 | LEI, CRV, CHG, BSS | Sim | — |
| **6** | Acervo de skills | 3, 7, 10, 15 | CSD, RND, VTB | Sim | — |
| **7** | Parede humana ampliada | 4, 16, 20 | CTR, LUC, MIR | Sim | — |
| **8** | Julgamento subjetivo | 23 | CND, RDA, VTO | Sim | — |
| **9** | Governança | 19, 14 | TSR, RUI, VTB | Sim | — |
| **10** | Papéis novos | 9, 11, 12 | CLR, OSW, FRE | Sim | — |
| **11** | Produção | 28, 29, 31, 32 | EMB, CFR, QLB | Não (infra) | — |

**Caminho crítico:** 0 → 1 → 2 → 3 → 4 → 5. As ondas 6 a 11 têm folga de ordem entre si depois da 5, com duas exceções travadas: **8 depende de 9** (o modo gauntlet não liga sem `orcamentoPorCard`) e **10 depende de 3** (o `aprendiz` lê o diário por evento).

### Por que esta ordem

- **1 antes de tudo.** Rename depois de construir 32 itens é renomear duas vezes. Rename primeiro é mecânico, verificável e barato.
- **3 antes de 4.** De nada adianta um repair-loop melhor se um crash no meio dele abre PR duplicado. Parte VI é explícita: 25 e 26 são os dois que decidem se o motor "roda em produção" ou "roda numa VPS que você reinicia na mão".
- **5 antes de 6.** LEI precisa existir antes das skills, senão skill nova vira texto que o modelo pode ignorar — exatamente o que o item 13 fecha.
- **9 antes de 8.** Relatos de mercado registram sessões de gauntlet de centenas de dólares sem teto. `orcamentoPorCard` é pré-requisito declarado, não recomendação.

---

## ONDA 0 — Rede de segurança

**Objetivo:** tornar a Onda 1 verificável antes de mover um único arquivo.

### Escopo

| Entrega | Arquivo |
|---|---|
| Baseline registrado | `.hii/baseline-pre-rename.json` — saída de `bun run test`, contagem de arquivos, hash do tree |
| Mapa de rename executável | `scripts/renomear-brazil.mjs` — consome as tabelas §5 de `ARQUITETURA-BRAZIL.md` |
| Teste de guarda do mapa | `test/mapa-de-rename.test.ts` |

### `scripts/renomear-brazil.mjs` — contrato

```js
// Entrada: MAPA declarativo { origem: destino }, derivado de ARQUITETURA-BRAZIL.md §5
// 1. valida que TODA origem existe e NENHUM destino existe        -> senão aborta
// 2. valida que o mapa cobre 100% dos .ts sob lib/ e bin/lib/     -> senão aborta
// 3. git mv origem destino                                        -> preserva --follow
// 4. reescreve import/from/require em .ts do repo inteiro
// 5. NÃO toca em nome de arquivo de teste (R4) — só nos imports dele
// --dry-run é o default. Só escreve com --aplicar.
```

### Gate de saída

```bash
bun run test                                  # baseline verde, registrado
bun scripts/renomear-brazil.mjs --dry-run     # exit 0, cobertura 100%, zero destino ocupado
bun test ./test/mapa-de-rename.test.ts        # mapa é total e injetivo
```

**Reprova se:** algum `.ts` de `lib/` ou `bin/lib/` não estiver no mapa, ou dois destinos colidirem.

---

## ONDA 1 — Rename estrutural BRAZIL

**Objetivo:** `lib/` vira `motor/`, com a taxonomia como estrutura de diretório. Zero mudança de comportamento.

### Escopo — 10 commits, um por domínio

| # | Commit | Arquivos | Fonte |
|---|---|---|---|
| 1.1 | `refactor(cdl): card, contrato e ambiente` | 20 | §5.2 (card+contract) + ALI de §5.3-5.4 + CDL de §5.3-5.4 |
| 1.2 | `refactor(tmd): harness, MCP, tools, cache` | 25 | §5.1 (TMD/PNT/MAP) + tasks de §5.2 + `provider-trust` + `cache` |
| 1.3 | `refactor(euc): diário, telemetria e custo` | 18 | EUC/RDR/TSR de §5.1, §5.3, §5.4 |
| 1.4 | `refactor(qlb): isolamento e fronteiras` | 17 | QLB/CTR/ALF de §5.3 |
| 1.5 | `refactor(cic): loops, gate e retry` | 12 | CIC/CRV/RPR de §5.1, §5.3 |
| 1.6 | `refactor(nmy): grafo e planejamento` | 7 | NMY/LUC de §5.2, §5.3, §5.4 |
| 1.7 | `refactor(osw): orquestração, router e fila` | 9 | OSW/RTA/MTR de §5.3, §5.4 |
| 1.8 | `refactor(agentes): papéis` | 6 | ASS/CLR/TSL de §5.1, §5.3, §5.4 |
| 1.9 | `refactor(mir): interface humana` | 57 | MIR de §5.3, §5.4 (inclui render 24 + tui 8), §5.5 |
| 1.10 | `refactor(csd): conhecimento` + varredura fora de `.ts` | 1 + docs | §5.6 |

**Soma: 172 arquivos.** O script da Onda 0 valida essa soma contra `find lib bin/lib -name '*.ts' | wc -l` antes de mover qualquer coisa.

### Gate de saída — por commit, não só no fim

```bash
bun run typecheck      # zero erro
bun run lint:types     # zero any
bun run lint:clone     # clone limpo
bun run test:unit      # 151 suítes verdes
git log --follow motor/cic/passo-com-gate.ts | wc -l   # > 1: histórico preservado
```

### Gate de saída da onda

```bash
bun run test
test -z "$(find lib bin/lib -name '*.ts' 2>/dev/null)"   # lib/ não existe mais
grep -rn "from '.*lib/" --include='*.ts' . | grep -v node_modules   # zero import antigo
grep -rn "lib/" README.md tsconfig.json scripts/setup/*.mjs .claude/skills/*/SKILL.md   # zero resíduo
```

**Reprova se:** qualquer suíte mudar de resultado, ou sobrar referência a `lib/` fora de `node_modules` e do histórico.

> **Risco desta onda e como ele é contido.** É o maior diff do projeto (172 arquivos movidos + imports reescritos em 151 testes) e o de menor valor visível. O que o torna aceitável é ser 100% mecânico: a suíte inteira é a prova. Se algum commit exigir mudar lógica pra passar, **isso é sinal de que o mapa está errado** — corrige o mapa, não a lógica.

---

## ONDA 2 — Fundação plugável (TMD + NMY)

**Objetivo:** adicionar uma IA nova passa a ser um arquivo + uma linha de registro. E a topologia vira dado inspecionável.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 1 | `healthCheck(): Promise<boolean>` na interface `Harness` | `motor/tmd/tipos.ts` |
| 1 | `HarnessCapabilities` com `mcp: boolean`, substituindo `ProviderLimits` | `motor/tmd/tipos.ts` |
| 1 | `HarnessId` como `string` registrável, não união fechada | `motor/tmd/{tipos,registro}.ts` |
| 1 | `recusaPorLimite` consulta `capabilities()`, não nome de provedor | `motor/tmd/registro.ts` |
| §3.7 | Probe real do `kimi` — hoje cai em `return true` | `motor/tmd/sonda.ts` |
| 24 | `config/topologia.json` — nós, transições permitidas, checkpoints humanos | `config/topologia.json` |
| 24 | Validador de transição, chamado no `OSW` | `motor/nmy/topologia.ts` |

### Prova de que o item 1 fechou

Um harness novo entra sem tocar em `osw/`, `cic/` ou `nmy/`:

```
motor/tmd/harness/qwen.ts    # arquivo novo
motor/tmd/registro.ts        # +1 linha
```

### Gate de saída

```bash
bun run test
bun test ./test/registry-provedores.test.ts ./test/health-probe.test.ts ./test/limites-de-provedor.test.ts
# gate específico da onda — testes novos:
bun test ./test/harness-contrato.test.ts    # todo harness registrado implementa healthCheck e capabilities
bun test ./test/kimi-adapter.test.ts        # probe do kimi falha quando a API está fora
bun test ./test/topologia.test.ts           # transição fora da topologia é rejeitada
```

**Reprova se:** `topologia.json` divergir das transições que o `OSW` realmente executa. O teste compara os dois — o arquivo é a foto do motor, não uma intenção.

---

## ONDA 2b — Descritor completo do harness (TMD)

**Por que existe.** A Onda 2 estourou o escopo e virou duas, aplicando a R7. A
terceira bala do item 1 — *`HarnessId` como string registrável* — não é uma
mudança de tipo: exige tirar de tabelas centrais e cadeias `if (nome === …)`
tudo que ainda é conhecimento **sobre** cada harness. Levantamento real feito
durante a Onda 2:

| Onde | O quê |
|---|---|
| `motor/tmd/modos.ts` | `CATALOGO: Record<HarnessId, CatalogoDeModo>` |
| `motor/tmd/map/comandos.ts` | `CORES_DE_MARCA: Record<HarnessId, Rgb>` |
| `motor/tmd/disponibilidade.ts` | `BINARIO`, `COMANDO_DE_LOGIN`, e `if (nome === …)` na mensagem de instalação |
| `motor/euc/tsr/planos.ts` | `COM_LEITOR_DE_PLANO` + `if (nome === …)` para leitor de plano e autenticação |
| `motor/euc/rdr/doctor.ts` | `n !== 'ollama'`, `n === 'claude'` |
| `motor/cdl/ali/ambiente.ts` | `SEMPRE = ['claude', 'codex', 'ollama', …]` |
| `motor/cdl/ali/snapshot.ts` | `nome === 'ollama'` |

Enquanto isso não migrar para o descritor do harness, abrir `HarnessId` só
trocaria erro de compilação por erro de runtime — pior que o estado atual.

### Escopo

| Entrega | Arquivo |
|---|---|
| `Harness` ganha `modos`, `cor`, `binario`, `comandoDeLogin`, `leitorDePlano`, `autenticado()` | `motor/tmd/tipos.ts` |
| Cada harness passa a declarar os seus | `motor/tmd/harness/*.ts` |
| Tabelas centrais e cadeias `if (nome === …)` somem | os 7 arquivos acima |
| `HarnessId = string`; `PROVIDERS` vira `Map` | `motor/tmd/{tipos,registro}.ts` |

### Gate de saída

```bash
bun run test
bun test ./test/harness-novo.test.ts   # harness ficticio registrado no Map funciona ponta a ponta
# INVARIANTE da onda: nome de harness so aparece dentro de tmd/harness/
grep -rn "'claude'\|'codex'\|'kimi'\|'ollama'" motor/ --include='*.ts' | grep -v '^motor/tmd/harness/'
```

**Reprova se:** sobrar nome de harness fora de `motor/tmd/harness/`.

---

## ONDA 3 — Sobrevivência (SLV + EUC + RDR)

**Objetivo:** um crash no meio de um card vira "retoma de onde parou", não "abre PR duplicado e ninguém percebe".

> Parte VI é explícita: **esta é a maior lacuna de confiabilidade do motor hoje.**

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| §3.8 | Evento por fase em JSONL append-only: `gate_start`, `repair_attempt`, `gate_verdict`, `human_checkpoint`, `orfao` | `motor/euc/eventos.ts` |
| 25 | `executarComIdempotencia` — `hash(card + fase + tipo_operacao)`, grava **antes** de considerar concluída | `motor/qlb/slv/idempotencia.ts` |
| 25 | Toda operação com efeito externo passa por SLV: `git commit`, abrir PR, webhook, notificar, gravar custo | `motor/qlb/ctr/*.ts`, `motor/qlb/git.ts` |
| 26 | `retomarAoIniciar()` — reconstrói a fase de cada card sem evento final | `motor/euc/recuperar.ts` |
| 27 | Compensação por tipo: worktree órfão descarta, commit sem PR retoma, **PR órfão nunca abre um segundo** | `motor/qlb/slv/compensacao.ts` |
| 30 | `GET /health` + shutdown gracioso em `SIGTERM` | `motor/euc/rdr/servidor.ts`, `motor/osw/mtr/daemon.ts` |

### Tabela de compensação (Parte VI §3)

| Situação | Ação |
|---|---|
| Worktree criado, cai antes de qualquer commit | Retomar normal — worktree é descartável |
| Commit feito, cai antes do PR abrir | Retomar e abrir o PR |
| PR aberto, cai antes da parede humana fechar | Marcar `pr_orfao`. **Não abrir segundo PR** |
| Notificação disparada, diário não confirmou | Marcar `notificacao_incerta`. Humano confirma |

### Gate de saída

```bash
bun run test
bun test ./test/idempotencia.test.ts        # mesma chave 2x = 1 efeito, resultado gravado devolvido
bun test ./test/recuperacao.test.ts         # card interrompido em cada fase retoma na fase certa
bun test ./test/pr-orfao.test.ts            # crash pós-PR não abre segundo PR
bun test ./test/shutdown-gracioso.test.ts   # SIGTERM grava checkpoint antes de sair
curl -sf localhost:$PORTA/health            # exit 0
```

**Teste de aceitação manual, obrigatório — AINDA NÃO FEITO:** `kill -9` no daemon durante um card em `EXECUTING`, `URL`, e depois de `PR_OPEN`. Reinicia. Nos três casos o card retoma na fase correta e **nenhum efeito externo duplica**.

Os automatizados cobrem a lógica (`test/pr-orfao.test.ts` reproduz a sequência exata do PR duplicado), mas nenhum deles mata um processo de verdade nem fala com o GitHub. Precisa de um repo-alvo real e de um `gh` autenticado — é o único item da Onda 3 que fica pendente de execução humana.

---

## ONDA 4 — Autoresolução (CIC + RPR + ECO + TJL)

**Objetivo:** o "autoresolutivo" do pedido original. Falha de teste, build ou lint tenta se consertar com instrução estreita antes de acordar o humano.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| §3.2 | `runWithRepair(gate, ctx, harness, maxAttempts)` genérico, generalizando `passoComCrivo` | `motor/cic/reparo.ts` |
| §3.2 | Aplicado em `testes`, `seguranca` e `review` — hoje só existe pra URL | `motor/nmy/config.ts`, `motor/cic/crv/*.ts` |
| 6 | Registro de `BuildRepairer` por domínio | `motor/cic/rpr/reparadores/` |
| 6 | Primeiro reparador: Laravel/PHP (o stack real de uso) | `motor/cic/rpr/reparadores/laravel-php.ts` |
| 17 | Prefixo estável: `narrowFix` **anexa**, nunca reescreve o prompt | `motor/tmd/eco/prefixo.ts` |
| 18 | `executarEmBlocos` — bloco → valida → próximo, para cedo em base quebrada | `motor/nmy/tjl/blocos.ts` |

### As duas economias são diferentes — manter separadas no código

| Mecanismo | Preocupação | Ganho |
|---|---|---|
| `ECO` prefixo byte-idêntico | **custo** | Cache de prefixo do provedor (DeepSeek documenta até 30x em input cacheado) |
| `TJL` `Bloco.validar` | **qualidade** | Não pagar pela tarefa inteira pra descobrir no fim que a base estava errada |

### Gate de saída

```bash
bun run test
bun test ./test/reparo-generico.test.ts     # 1 tentativa estreita; teto respeitado; relato do que tentou
bun test ./test/eco-prefixo.test.ts         # prefixo byte-idêntico entre chamadas do mesmo card
bun test ./test/tjl-blocos.test.ts          # bloco 2 falho → blocos 3..N não executam
bun test ./test/reparador-laravel.test.ts   # domínio detectado; e o portão de build o consulta de fato
```

`reparo-teto` não virou arquivo próprio: os dois casos (teto respeitado, relato ao esgotar) vivem em `reparo-generico.test.ts`, junto do resto do contrato do loop.

**Reprova se:** o repair-loop rodar sem teto, ou reescrever o prefixo (mata o cache e o item 17 junto). Os dois têm invariante automatizada — uma varre `motor/` atrás de `while` de retry sem limite, a outra cobra que `passoComCrivo` use `abrirPrompt`/`anexarInstrucao` em vez de concatenar sufixo solto.

### Correção de premissa

O `MODERNIZATION.md` (Parte I, §3.2) diz que o repair loop *"só está aplicado a um caso (subida do servidor)"*. Não está: o motor já tinha **quatro** cópias — `buildWithReajuste`, `testGate`, `passoComCrivo` e o conserto de URL. Eram estruturalmente iguais e já divergiam no que importa: só uma tinha veredicto `inconclusivo`, nenhuma levava o relato do que foi tentado ao humano, nenhuma escrevia no diário.

Então o trabalho do §3.2 foi **deduplicar**, não criar o primeiro. `motor/cic/reparo.ts` é a versão única; `buildWithReajuste` e `testGate` passaram a chamá-la e viraram um portão só, parametrizado.

### TJL ainda não tem chamador — e isso é dependência real, não esquecimento

`motor/nmy/tjl/blocos.ts` está pronto e testado, mas nada o invoca ainda: **quem fatia uma tarefa em blocos é o `core/agent-executor.ts` do item 11**, que é Onda 10. Ligar TJL antes disso exigiria inventar aqui um critério de fatiamento que o item 11 vai definir — e aí seriam dois critérios brigando.

---

## ONDA 5 — Rigor determinístico (LEI + CRV + CHG + BSS)

**Objetivo:** fechar o vetor de bypass onde a própria IA subdeclara risco pra pular gate, e dar critério escrito ao juiz.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 2 | `riscoPeloDiff(files)` — heurística sobre o diff, independente do que o card diz | `motor/csd/lei/guarda.ts` |
| 2, 13 | **O card pode subir o rigor, nunca baixar** — invariante testada | `motor/csd/lei/guarda.ts` |
| 13 | `config/regras-inegociaveis.json` + `regrasQueBatem(files, regras)` | `config/`, `motor/csd/lei/guarda.ts` |
| 8 | `config/review-criteria.json` — checklist objetivo, versionado, auditável | `config/` |
| 8 | `CRV` roda contra o critério; reprovar volta ao implementador **com o motivo** | `motor/cic/crv/criterios.ts` |
| 21 | Matriz de cenário: acerto, erro conhecido, borda, validação de entrada, validação de saída | `config/review-criteria.json` |
| 5 | RED antes de GREEN obrigatório no perfil `completo`, com evidência anexada ao card | `motor/agentes/chg/red-primeiro.ts` |
| 22 | Projeto/feature nova não avança da Fase 1 sem teste rodando e debug documentado | `motor/cdl/bss/setup-ferramental.ts` |

### Gate de saída

```bash
bun run test
bun test ./test/lei-guarda-de-risco.test.ts   # diff em migrations/ força perfil completo mesmo com risk: low
bun test ./test/lei-nunca-baixa.test.ts       # INVARIANTE: nenhuma entrada faz o card perder exigência
bun test ./test/crv-criterio.test.ts          # reprovação cita o critério violado por id
bun test ./test/chg-red-primeiro.test.ts      # GREEN sem RED registrado é reprovado
bun test ./test/bss-setup-ferramental.test.ts # projeto novo sem config de teste não sai da Fase 1
```

**Reprova se:** existir qualquer caminho em que `regras-inegociaveis.json` deixe de ser cobrado. O teste `lei-nunca-baixa` é o mais importante desta onda.

---

## ONDA 6 — Acervo de skills (CSD)

**Objetivo:** papel deixa de ser agente hardcoded e passa a ser loadout + skills carregadas do disco. Adicionar conhecimento novo para de tocar no motor.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| — | Loader de `SKILL.md` com frontmatter (`id`, `appliesToRoles`, `trigger`) | `motor/csd/acervo.ts` |
| — | Resolver `_native` + `_sources` → `_resolved`, determinístico e versionado | `motor/csd/resolver.ts` |
| — | `config/skill-sources.json` + `resolutionOrder` (`_native` sempre primeiro) | `config/` |
| — | `ORIGIN.json` + `LICENSE.txt` por origem externa | `skills/_sources/<origem>/` |
| 3 | Pack `common/`: `coding-standards`, `git-workflow`, `api-design`, `security-baseline`, **`search-first`** | `skills/_native/common/` |
| 7 | `config/security-checklist/<stack>.json`, consumido por VTB | `config/security-checklist/` |
| 10 | Pack `games-multiplatform/` — o gap que nenhum dos 5 orquestradores estudados cobre | `skills/_native/games-multiplatform/` |
| 15 | Notas de referência 2026 aplicadas em cada `SKILL.md` | todo o acervo |

### Invariantes do acervo

- `trigger` é **determinístico** — arquivo tocado, extensão, dependência declarada. **Nunca "pergunta pra IA se aplica"**
- Ninguém edita `_resolved/` na mão. É recalculada quando `skill-sources.json` muda
- Empate de `id` sem `_native` envolvido é **erro de build**, não resolução silenciosa
- Correção obrigatória em `netcode-multiplayer-patterns`: **Godot não tem client-side prediction/rollback nem matchmaking nativo em 2026** — alertar explicitamente antes que alguém escolha Godot pra netcode competitivo

### Gate de saída

```bash
bun run test
bun test ./test/csd-acervo.test.ts          # frontmatter inválido = erro de carga, não skill ignorada
bun test ./test/csd-resolver.test.ts        # _native vence; empate sem _native = exit != 0
bun test ./test/csd-trigger.test.ts         # trigger é função pura de (files, deps), sem chamada de IA
bun run lint:clone                          # _resolved/ é gerada, não versionada suja
```

---

## ONDA 7 — Parede humana ampliada (CTR + LUC + MIR)

**Objetivo:** hoje a parede humana só existe no merge. Passa a existir também antes de escrever a primeira linha de código.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 20 | `matriz-entendimento-<card>.md` — requisito, contrato de entrada, contrato de saída, casos de borda, dependência/risco, definição de pronto | `motor/nmy/luc/matriz-entendimento.ts` |
| 4 | Fase 4: humano aprova ou edita o plano antes da implementação começar | `motor/qlb/ctr/aprovar-plano.ts` |
| 16 | `/orquestrador-{jogos,dev-web,android,devops}` — **atalhos de intake**, não orquestradores | `motor/mir/comandos-manuais.ts` |
| 16 | `/layout` como método padrão de entrada na Fase 3 | `motor/mir/comandos-manuais.ts` |

### Pilar 1, traduzido

"95% de entendimento" **não** é autorrelato do modelo. Vira: **toda linha da matriz preenchida e confirmada por humano**. É checável em disco, como todo gate do motor.

### Gate de saída

```bash
bun run test
bun test ./test/luc-matriz.test.ts             # matriz incompleta trava a saída da Fase 4
bun test ./test/ctr-aprovar-plano.test.ts      # sem aprovação humana o card não entra em EXECUTING
bun test ./test/mir-comandos-manuais.test.ts   # comando manual só pré-carrega skillPacks; pipeline é o mesmo
```

**Reprova se:** um comando manual criar caminho de execução paralelo. Ele carrega conteúdo diferente, roda o mesmo pipeline (R5).

---

## ONDA 8 — Julgamento subjetivo (CND + RDA + VTO)

> **Trava:** só começa com a Onda 9 fechada. `orcamentoPorCard` é pré-requisito declarado.

**Objetivo:** avaliar o que `review-criteria.json` não alcança — UI, tela de jogo, sensação de interação — sem cair em autoavaliação.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 23 | Gauntlet Loop: comparação **cega** contra referência externa concreta e buscável | `motor/cic/cnd/gauntlet.ts` |
| 23 | Múltiplos críticos com lentes distintas → `RDA` consenso / `VTO` voto | `motor/cic/{rda,vto}.ts` |
| 23 | Boundary obrigatório: recusa iniciar sem `orcamentoPorCard.tetoUsd` configurado | `motor/cic/cnd/gauntlet.ts` |

### Onde o modo gauntlet vale, e onde não

| Domínio | Modo |
|---|---|
| `frontend-web`, `games-multiplatform` | `gauntlet` — existe referência de mercado comparável |
| Lógica de negócio pura (ex: cálculo de comissão) | `review-criteria.json` — **não existe screenshot de referência pra "comissão calculada certo"** |

### Gate de saída

```bash
bun run test
bun test ./test/cnd-boundary.test.ts        # sem teto de orçamento, CND recusa iniciar (exit != 0)
bun test ./test/cnd-comparacao-cega.test.ts # o crítico não sabe qual candidato é o do motor
bun test ./test/cnd-dominio.test.ts         # domínio de lógica pura NÃO habilita gauntlet
```

**Reprova se:** CND puder rodar sem teto de custo. Relatos de mercado registram sessões de centenas de dólares sem boundary — é o risco declarado do item.

---

## ONDA 9 — Governança (TSR + RUI + VTB)

**Objetivo:** custo por ação vira decisão auditável em arquivo, não hábito implícito no código. E a config do próprio agente vira superfície auditada.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 19 | `config/model-tier.json` com `tier` **e `motivo`** por ação | `config/` |
| 19 | `regraDeSubida`: card ou regra LEI pode forçar tier acima do padrão, **nunca abaixo** | `motor/osw/rui.ts` |
| 19 | `orcamentoPorCard.tetoUsd` + `acaoAoEstourar: "pausar e notificar humano"` | `motor/euc/tsr/orcamento.ts` |
| 19 | Evento `model_tier_selected` com o motivo, no diário EUC | `motor/euc/eventos.ts` |
| 14 | `auditoria_harness` — grep determinístico por prompt injection em `SKILL.md`, `mcp.json`, hooks | `motor/agentes/vtb/auditoria-harness.ts` |
| 14 | Roda **antes** de qualquer skill nova (humana ou promovida por FRE) carregar em produção | `motor/csd/acervo.ts` |

### Gate de saída

```bash
bun run test
bun test ./test/tsr-tier.test.ts            # tier vem do arquivo; toda seleção grava motivo no diário
bun test ./test/tsr-orcamento.test.ts       # estourar o teto pausa o card e notifica; não continua
bun test ./test/rui-nunca-baixa.test.ts     # INVARIANTE: nada rebaixa tier abaixo do padrão da ação
bun test ./test/vtb-auditoria-harness.test.ts  # SKILL.md com "ignore as instruções anteriores" é barrada
```

---

## ONDA 10 — Papéis novos (CLR + OSW + FRE)

**Objetivo:** fechar o loop de aprendizado. O que o motor aprende para de ser "mais um texto pro modelo ler" e vira condição que o gate cobra.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 9 | `doc-updater` — docs atualizadas quando a mudança afeta contrato público | `motor/agentes/clr/doc-updater.ts` |
| 11 | `despacharAgentesNaFase(specs)` — orchestrator-workers dentro de uma fase | `motor/osw/despacho-de-agentes.ts` |
| 11 | Quem decide `specs` é função determinística sobre diff/card. **Nunca "a IA decide se chama outro agente"** | `motor/osw/despacho-de-agentes.ts` |
| 12 | `aprendiz` — roda 1x no fechamento do card, depois do merge | `motor/csd/fre/aprendiz.ts` |
| 12 | Lê o **diário EUC**, não o código. Audita como o card se comportou | `motor/csd/fre/aprendiz.ts` |
| 12 | `ProblemSignature` = `hash(dominio + tipo_falha + causa_raiz)`, com evidência do diário — nunca opinião do modelo | `motor/csd/fre/assinatura.ts` |
| 12 | `.hii/candidatos-regras/<assinatura>.json` — acumula sem efeito no gate até N cards (default 3) | `motor/csd/fre/candidatos.ts` |

### A regra de ouro do FRE

Nenhuma das duas trilhas — instinto macio ou regra dura — é lida de volta como instrução confiável **dentro da mesma sessão que a gerou**. Sempre passa por revisão humana em lote primeiro. É a fronteira de confiança de memória que o ECC documentou, e ela não é negociável.

### Gate de saída

```bash
bun run test
bun test ./test/fre-assinatura.test.ts       # mesma causa raiz em cards diferentes = mesma assinatura
bun test ./test/fre-limiar.test.ts           # 2 ocorrências não promovem; 3 propõem; promoção exige humano
bun test ./test/fre-nao-executa.test.ts      # candidato NUNCA afeta gate antes de virar LEI
bun test ./test/osw-despacho.test.ts         # specs vêm de função pura; paralelo só sem sobreposição de arquivo
bun test ./test/clr-doc-updater.test.ts
```

---

## ONDA 11 — Produção (EMB + CFR + QLB)

**Objetivo:** a mesma imagem roda em VPS, AWS, Azure e GCP sem escolher lado.

### Escopo

| Item | Entrega | Arquivo |
|---|---|---|
| 28 | `Dockerfile` único, **sem SDK de nuvem nenhum no motor** | `Dockerfile` |
| 28 | `docker-compose.yml` cobrindo o caso VPS | `docker-compose.yml` |
| 28 | Config via variável de ambiente (12-factor); estado em volume externo ao container | `motor/cdl/ali/` |
| 29 | `EnvSecretProvider` como caminho **sempre funcional**; cofre de nuvem opcional e plugável | `motor/qlb/cfr/segredos.ts` |
| 31 | Snapshot do volume (diário, worktrees) + `skills/` e regras **sempre em git**, nunca só no disco de produção | `docker-compose.yml`, `scripts/` |
| 32 | Teto de CPU/memória por worktree paralelo | `docker-compose.yml`, `motor/qlb/limites.ts` |

### Gate de saída

```bash
bun run test
docker build -t hii:brazil .                            # exit 0
docker run --rm hii:brazil node -e 'process.exit(0)'    # sobe sem SDK de nuvem
bun test ./test/cfr-segredos.test.ts                    # sem env obrigatória = erro claro, não fallback silencioso
grep -rn 'aws-sdk\|@azure/\|@google-cloud' motor/ package.json   # zero ocorrência no motor
bun test ./test/qlb-limites.test.ts
```

---

## 2. Rastreamento — 32/32

| # | Item | Onda | Dono |
|---|---|---|---|
| 1 | Harness interface formal | 2 + 2b | TMD |
| 2 | Guarda de risco sobre o diff | 5 | LEI |
| 3 | `search-first` em `common/` | 6 | CSD |
| 4 | Confirmação humana do plano | 7 | CTR |
| 5 | RED antes de GREEN | 5 | CHG |
| 6 | `BuildRepairer` por domínio | 4 | RPR |
| 7 | Checklist de segurança por stack | 6 | VTB |
| 8 | Critério escrito pro crivo | 5 | CRV |
| 9 | `doc-updater` | 10 | CLR |
| 10 | Pack `games-multiplatform/` | 6 | CSD |
| 11 | Despacho dinâmico numa fase | 10 | OSW |
| 12 | `aprendiz` + candidatos a regra | 10 | FRE |
| 13 | `regras-inegociaveis.json` | 5 | LEI |
| 14 | Auditoria do próprio harness | 9 | VTB |
| 15 | Notas 2026 em cada `SKILL.md` | 6 | CSD |
| 16 | Comandos manuais + `/layout` | 7 | MIR |
| 17 | Prefixo estável | 4 | ECO |
| 18 | Blocos com validação incremental | 4 | TJL |
| 19 | `model-tier.json` + orçamento | 9 | TSR |
| 20 | Matriz de entendimento | 7 | LUC |
| 21 | Matriz de cenário | 5 | CRV |
| 22 | Setup ferramental na Fase 1 | 5 | BSS |
| 23 | Modo `gauntlet` | 8 | CND |
| 24 | `topologia.json` | 2 | NMY |
| 25 | Idempotência | 3 | SLV |
| 26 | Retomada no restart | 3 | EUC |
| 27 | Evento `orfao` + compensação | 3 | SLV |
| 28 | `Dockerfile` + compose | 11 | EMB |
| 29 | `secrets.ts` | 11 | CFR |
| 30 | `/health` + shutdown gracioso | 3 | RDR |
| 31 | Snapshot + git | 11 | EMB |
| 32 | Limite por worktree | 11 | QLB |

Adicionais fora da lista de 32, absorvidos: **§3.7** probe real do `kimi` (Onda 2), **§3.2** repair loop genérico (Onda 4), **§3.8** diário por evento (Onda 3), **Parte IV** modelo multi-origem de skills (Onda 6).

---

## 3. Critério de parada e o que NÃO fazer

### Pare a onda e reavalie se

- Um commit da **Onda 1** precisar de mudança de lógica pra passar no teste → o mapa de rename está errado, não a lógica
- Uma onda de feature precisar mexer em módulo de outro dono → ou o mapa de donos está errado, ou a onda está grande demais (R7)
- Um gate novo só puder ser verificado perguntando pra um modelo → não é gate, é teatro. Reescreva como checagem em disco (R1)
- Alguém propuser um "modo" novo → R5

### Decisões já tomadas, não reabrir sem caso concreto

| Decisão | Fonte |
|---|---|
| Sem LangGraph / CrewAI / AutoGen | MODERNIZATION Parte I §4 |
| Sem Temporal nem motor de execução durável — pega os princípios (checkpoint, idempotência, jornal), não o motor | Parte VI §0 |
| Sem tmux — paralelismo é N cards × N worktrees, que já dá isolamento de **arquivo**, não só de processo | Parte III §9 |
| Sem instalar ECC / wshobson / Maestro / OMC / Ruflo como orquestrador paralelo — entram como **catálogo de conteúdo** em `skills/_sources/` | Parte II §4, Parte IV |
| Sem troca automática de provedor em cota estourada | Parte I §4 |
| `NMY` é dado inspecionável, não motor de grafo | Parte I §3.9, item 24 |

---

## 4. Primeiro passo concreto

```bash
git checkout main && git pull
git checkout -b feat/brazil-onda-0

# 1. registrar o baseline
bun run test 2>&1 | tee .hii/baseline-pre-rename.txt

# 2. escrever scripts/renomear-brazil.mjs a partir de ARQUITETURA-BRAZIL.md §5
# 3. bun scripts/renomear-brazil.mjs --dry-run   -> tem que dar cobertura 100%
```

Onda 0 é a menor de todas e a única que não pode ser pulada: sem ela, a Onda 1 é um rename de 180 arquivos sem prova de que nada quebrou.

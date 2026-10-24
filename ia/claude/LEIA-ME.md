# ia/claude — a pasta da IA Claude do motor

Esta pasta é a configuração versionada do Claude que o motor HII chama. Ela troca o
`~/.claude` pessoal: o Claude do motor não carrega hooks, skills, `CLAUDE.md`, MCP nem
comandos da conta de quem roda o motor, salvo no recuo do modo conta (abaixo). Codex e
Kimi não usam esta pasta e não ganham nenhuma flag nem comando dela.

| Arquivo | Para que serve |
| --- | --- |
| `regras.md` | regras do motor, anexadas ao prompt de sistema (`--append-system-prompt-file`) em toda chamada de leitura e de escrita |
| `settings.json` | negações do motor (`permissions.deny`): push, merge, criar PR, `rm -rf /`, `npm publish`, ler `~/.claude/.credentials.json` |
| `mcp.json` | servidores MCP que a pasta declara: `{"servidores":["omc"]}` |
| `comandos/*.md` | os 5 comandos do `/hii` global, adaptados ao motor: `hii`, `hii-plan`, `hii-refinar`, `hii-review`, `hii-review-pr` |

## O papel decide as flags

Cada chamada ao Claude cai num de três papéis. O papel é recalculado a cada chamada
(retentativa incluída) com a config do momento.

| Papel | Quando | Flags |
| --- | --- | --- |
| **leitura** | modo `readonly`, sempre, mesmo com tool de MCP pedida | `--tools Read,Glob,Grep` · `--setting-sources ""` · `--settings` com `disableAllHooks: true` · `--strict-mcp-config` sem `--mcp-config` · `--disable-slash-commands` · `--no-session-persistence` · `--append-system-prompt-file ia/claude/regras.md` · sem `--permission-mode` |
| **escrita** | modo `edit` sem tool de MCP, ou só com tools de servidor declarado em `mcp.json` e com definição legível | `--tools Read,Edit,Write,Glob,Grep,Bash,Skill` (mais `Task` quando a tarefa usa agentes) · `--setting-sources project,local` · `--strict-mcp-config` · `--mcp-config` inline só com os servidores declarados que a tarefa usa · `--no-session-persistence` · `--append-system-prompt-file ia/claude/regras.md` · `--permission-mode acceptEdits`, como antes |
| **conta** | modo `edit` com tool de servidor não declarado, ou declarado sem definição legível | `--setting-sources user,project,local` · `--settings` com `disableAllHooks: true` · sem `--strict-mcp-config` e sem `--mcp-config` (vale o MCP da conta) · `--disable-slash-commands` · `--tools` sem `Skill`, e com `Task` só quando a tarefa usa agentes |

Todas essas flags vêm antes do primeiro `--add-dir`, e o argv em JSON e em stream só difere
nas flags de formato. Com o Claude apontado para o Ollama, o ambiente do Ollama entra no
mesmo `--settings`; continua havendo um único `--settings` e um único `--setting-sources`.

O que muda para quem opera:

- **Settings pessoais não valem na escrita.** `model`, `env` e plugins de
  `~/.claude/settings.json` deixam de ser carregados; valem os do projeto-alvo
  (`.claude/settings.json` e `.claude/settings.local.json`).
- **Hooks no modo conta.** `disableAllHooks` desliga também os hooks do projeto-alvo.
- **Sessão não gravada.** Leitura e escrita rodam com `--no-session-persistence`: nada vai
  para `~/.claude/projects`.
- **Sem `/hii` global ao alcance.** Leitura e conta têm slash desligado e nenhuma tem `Skill`
  da conta; a escrita só enxerga skills do projeto-alvo.

## O MCP declarado

`mcp.json` lista o nome; a definição sai do `mcpServers` do `~/.claude.json` (ou do
arquivo em `HII_CLAUDE_CONFIG`), só com `type`, `command`, `args`, `env` e `url`, e vai
inline no `--mcp-config` de cada chamada. Só o que a pasta declara sai da config pessoal.

- A tool `t` pertence ao servidor `omc` se `t` é `mcp__omc` ou começa com `mcp__omc__`.
  `mcp__omcx__lsp_hover` não é do `omc`.
- `omc` vindo de plugin ou do escopo local não está no `mcpServers` do topo: a chamada cai
  no modo conta, e a tool continua no `--allowedTools`. Config ilegível ou ausente, idem.
- Servidor com `headers` ou `oauth` também cai no modo conta: a credencial não vai para o
  argv, e sem ela a tool falharia no meio da execução. O stderr diz o motivo:

  ```
  [hicode] Claude no modo conta (servidor omc autenticado por headers no mcpServers, credencial que o motor nao leva para o argv) — ...
  ```
- O `env` de um servidor vai no argv e aparece na lista de processos da máquina. Não ponha
  segredo no `env` de um servidor declarado aqui.

## Como cada comando chega ao Claude

O frontmatter de cada arquivo em `comandos/` tem `description` e `canal`. O `canal` só é
lido nos arquivos desta pasta; um `.claude/commands` de repositório alheio não desvia o
despacho, e um `~/.claude/commands/hii-review.md` pessoal não substitui o daqui.

**Escrita, pela instrução da tarefa (`hii`, `hii-refinar`).** O corpo do comando entra no
prompt de quem implementa quando o texto da tarefa contém a palavra com barra:

```
/hii-refinar organizar o modulo de caixa
```

Na TUI, com uma tarefa seguida, isso vira instrução dessa tarefa. O `comandos/hii.md` só
chega ao prompt quando o texto da tarefa contém `/hii`. O pedido orquestrado da TUI
(`/hii implemente a API`) cria a execução, e o card nasce **sem** a barra, então esse corpo
não entra por esse caminho.

**Leitura, pela conversa (`hii-plan`, `hii-review`, `hii-review-pr`).** Na TUI, o comando
vira consulta e não toca em tarefa nenhuma; na API, vai em `POST /v1/ask`:

```
/hii-review
/hii-review-pr 42
/hii-plan desenhar o resumo do caixa
```

```bash
curl -s -X POST http://127.0.0.1:<porta>/v1/ask \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"repo":"org/app","pergunta":"/hii-review"}'
```

- Roda na IA de verify, que tem de ser o Claude (`claude` ou `claude-ollama`), qualquer que
  seja a IA do implement. Com outra IA em verify, a resposta é uma parada dizendo qual.
- Roda no diretório do projeto, em modo leitura, com o corpo do comando e o contexto no prompt.
  TUI e `/v1/ask` montam o mesmo prompt (comando, contexto, retrato do ambiente, regras do
  projeto); a TUI acrescenta só as últimas trocas da conversa:
  - `hii-review`: o diff do working tree contra HEAD, mais os arquivos não rastreados.
    Com a árvore limpa, os commits da branch desde a base (`<base>...HEAD`), com a base
    sendo a primeira que existir entre `@{u}`, `origin/HEAD`, `main` e `master`. O
    cabeçalho `DIFF (...)` diz qual. O git só faz `rev-parse`, `diff` e `ls-files`, com
    `GIT_OPTIONAL_LOCKS=0`;
  - `hii-review-pr N`: `gh pr view N --json` (título, corpo, estado, revisões, refs) e
    `gh pr diff N`, com `GH_PROMPT_DISABLED=1`. O corpo vai no prompt como `CORPO DO PR`,
    cortado em 4000 caracteres, porque a IA de leitura não tem `gh`;
  - `hii-plan`: sem contexto. A saída é um plano v1 para `hii pipeline plan`.
- O tempo segue o tamanho do contexto, como no gate (mínimo de 180 s). Pergunta comum
  continua com 120 s.
- Sai uma parada, sem chamar a IA e com custo zero. Bloqueio e falha têm estados
  diferentes:

  | Caso | `/v1/ask` (`estado`) | TUI (`ok`) |
  | --- | --- | --- |
  | sem projeto, IA de verify fora do Claude, número de PR inválido | `succeeded` | `true` |
  | diff vazio, ou árvore limpa sem base | `succeeded` | `true` |
  | PR fechado, em rascunho, mergeado ou já aprovado, ou sem diff | `succeeded` | `true` |
  | `git` falhou, `gh` falhou (ex.: sem `gh auth`), `gh` devolveu JSON ilegível | `failed` | `false` |

  Nos dois casos a `resposta` traz o texto da parada. Exemplo de falha lida em
  `GET /v1/consultas/<id>`:

  ```json
  {"estado":"failed","resposta":"/hii-review-pr: gh falhou ao ler o PR #7 (To get started with GitHub CLI, please run:  gh auth login); confira gh auth status e repita","custoUsd":0}
  ```
- Só o primeiro token ativa o comando: `o que faz /hii-review?` é pergunta comum.
- Comando de leitura nunca entra no prompt de escrita. Isso vale também para caminhos
  como `docs/hii-review/x.md`.
- Nada é publicado no GitHub.

Com o implement no Claude, os 5 aparecem no catálogo (`/v1/recursos`) com origem
`orquestrador`. O autocomplete da TUI segue a IA do implement: com implement no Codex,
`/hii-review` funciona mas não é sugerido.

## A pasta no aval

O conteúdo desta pasta entra no hash do pacote de execução quando algum papel (implement,
verify, gate ou step) roda no Claude. Mudou um arquivo daqui, o card aprovado antes pede
aval de novo. Com todos os papéis fora do Claude, o hash é o mesmo de antes da pasta.

## O que fica para as próximas fases

O `/hii` global faz coisas que o motor do repo ainda não tem, e que esta pasta não promete:

- **zambot**: gate adversarial com critério escrito, lotes e passada do conjunto;
- **guarda anti-sabotagem**: recusar teste afrouxado ou apagado para o critério passar;
- **vermelho/verde**: provar que o teste falha antes do código e passa depois, nos mesmos blobs;
- **aval amarrado ao fingerprint**: o aval humano vale para uma árvore exata, e muda se ela mudar;
- **lentes com fan-out**: uma chamada por lente, em paralelo, com veredito consolidado
  (hoje o `/hii-review` roda as lentes numa chamada só);
- **publicação no PR**: comentários inline e aprovação a partir do `/hii-review-pr`.

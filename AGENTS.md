# Trabalhar no HII com IA

HII é o motor TypeScript/Bun que executa tarefas em repositórios registrados.
Leia o código do caminho afetado: o README também descreve fluxos legados.

## Checkout e estado operacional

- Não edite nem commite em `main`. Para trabalho novo, use branch/worktree a
  partir de `origin/main` atualizado. Preserve mudanças que já existam.
- Se o HII já forneceu o worktree e a branch da tarefa, continue neles. Retome a
  branch existente; só refaça do zero quando o usuário pedir.
- Ao melhorar o próprio motor, separe a instalação estável do clone-alvo e do
  worktree candidato. Não atualize o código do daemon durante a tarefa.
- Não rode `bun link`, `hii start`, `hii restart`, `hii once` ou `runner.ts` só para
  testar uma mudança: podem trocar o executável ou consumir a fila real. Use as
  fixtures dos testes; uma operação real precisa fazer parte da tarefa solicitada.
- Não altere cards, sessões, PID/lock, credenciais ou preferências de IA da
  instalação ativa para fazer um teste passar. Nunca remova um lock sem verificar
  seu dono. O merge de PR permanece humano.

## Mapa para localizar uma mudança

| Área | Entrada principal |
| --- | --- |
| Fila, concorrência e recuperação | `runner.ts`, `motor/oswaldo/mutirao/`, `motor/euclides/recuperar.ts` |
| Gateway e execução com pipeline | `motor/oswaldo/gateway.ts`, `motor/oswaldo/executar.ts` |
| Plano, dependências e evidências | `motor/oswaldo/orquestracao/` |
| Provedores, capacidades e troca de IA | `motor/tomada/` |
| Gates, correção e espera | `motor/ciclo/` |
| Worktree, fecho e PR | `motor/quilombo/git.ts`, `motor/quilombo/cartorio/` |
| Cards, persistência e contrato do alvo | `motor/cordel/` |
| CLI, TUI e API | `bin/hii.ts`, `motor/mirante/`, `motor/api/` |
| Skills injetadas pelo motor | `motor/cascudo/`, `skills/` |

## Invariantes ao implementar ou revisar

- Pedido comum usa gateway no checkout registrado; `/hii <pedido ou spec>` na
  TUI cria execução orquestrada (`motor_modo: passivo`). `COMPLETED` do gateway
  não comprova que houve worktree, gate ou PR.
- O plano aceita dependências; `executarPlano` executa microtarefas em série.
  Não prometa paralelismo interno sem implementar isolamento e integração.
- Papéis injetados no prompt não são necessariamente processos/subagentes.
  Respeite as capacidades declaradas pelo adaptador usado.
- Critério obrigatório sem evidência, com timeout ou inconclusivo não aprova.
  Evidência deve corresponder ao trabalho atual, incluindo arquivos novos.
- Preserve parada humana, contabilização de custo, classificação de falhas e
  retomada sem repetir efeitos já concluídos. Custo desconhecido não é custo zero.
- Use os pontos de persistência e lock existentes. Não crie uma segunda fila ou
  outro orquestrador para controlar o mesmo card.

## Validação proporcional

Use Bun na versão de `.bun-version` e Node 24, como a CI. Instale dependências
no checkout de trabalho com `bun install --frozen-lockfile` quando necessário.

- Documentação/skills: valide referências e exemplos contra CLI/código; use
  `git diff --check`. Não crie testes que apenas procurem frases nos documentos.
- Mudança de comportamento: reproduza com fixture isolada e rode os testes
  afetados sob Node e Bun. Para vários arquivos Bun, execute um processo por
  arquivo; a suíte depende desse isolamento.
- Antes de entregar alterações no motor: `bun run typecheck`, `bun run lint:types`,
  `bun run lint:clone`, `bun run test:unit` e `bun run test:node` (ou `bun run test`).
  Em máquina carregada, `HII_TEST_JOBS=2 bun run test:unit` limita a piscina.
- Para alterações de TUI/renderização, acrescente `bun run test:tui:e2e` e
  `node scripts/validar-visualizador.mjs`; veja `docs/validacao-tui.md`.

Não declare suíte completa ou execução real de IA quando só rodou testes
selecionados. Registre falhas preexistentes e limites da validação.

## Procedimentos reutilizáveis

Skills locais do Codex em `.agents/skills/`:

- `hii-desenvolver`: implementar uma melhoria delimitada.
- `hii-diagnosticar`: investigar card parado, falha ou ausência de progresso.
- `hii-revisar`: revisar mudanças e suas garantias antes do merge humano.

O diretório `skills/` é o acervo do motor, não um espelho de `.agents/skills/`.
ECC é opcional: aproveite procedimentos pertinentes sem importar toda a
configuração, substituir o controle do HII ou depender de `/comandos` de outro CLI.
Procedimento operacional: [docs/autoaperfeicoamento.md](docs/autoaperfeicoamento.md).

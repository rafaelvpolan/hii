# Melhorar o HII com IA e com o próprio motor

Use a IA diretamente para alterar o mecanismo que conduz a execução (fila,
retomada, harnesses, orçamento e orquestração). Use o pipeline do HII para tarefas
delimitadas sobre seu próprio repositório, com validação e PR. Ambos usam as mesmas
instruções versionadas; não é necessário instalar o ECC para começar.

## Onde ficam as instruções

| Arquivo/diretório | Consumidor e finalidade |
| --- | --- |
| `AGENTS.md` | Codex e agentes orientados pelo projeto: arquitetura, invariantes e validação |
| `.agents/skills/hii-*/SKILL.md` | Skills locais do Codex para desenvolver, diagnosticar e revisar |
| `CLAUDE.md` | Entrada do Claude; remete às regras comuns |
| `.hii/rules.md` | Regras curtas que o HII injeta no pipeline do alvo |
| `skills/` | Acervo carregado pelo próprio motor; é outro mecanismo |

As skills são versionadas com o repositório, não copiadas para a configuração
global da máquina. Abra uma nova sessão do Codex no checkout que contém os arquivos
para sua descoberta. Um processo já aberto pode precisar de uma nova sessão.
Se a skill não aparecer, peça explicitamente para ler seu `SKILL.md`; não presuma
que foi carregada. Outros harnesses podem ler as instruções como arquivos, mas a
descoberta automática de `.agents/skills` depende do cliente.

## Desenvolvimento direto no Codex

No terminal WSL, crie um worktree a partir da base atualizada. Ajuste o nome da
branch e do diretório se já existirem; não sobrescreva trabalho anterior.

```bash
cd ~/projects/hii
git fetch origin main
git worktree add -b codex/hii-melhoria ../hii-melhoria origin/main
cd ../hii-melhoria
bun install --frozen-lockfile
codex
```

Se a tarefa já tem branch/worktree, abra o Codex nela em vez de criar outra.
Dentro do **chat do Codex**, exemplos:

```text
$hii-desenvolver Implemente a issue #N. Reproduza o defeito com fixture isolada, preserve os contratos e entregue um PR sem merge.
$hii-diagnosticar Investigue por que o card informado não progride. Não altere seu estado nem reinicie o motor.
$hii-revisar Revise o diff desta branch contra origin/main e relate regressões com evidências.
```

Troque `#N` pelo número real. Issue/PR só são criados quando fazem parte do pedido.
As skills orientam a IA; não acrescentam, por si só, paralelismo ou subagentes ao
adaptador HII. Para mudanças apenas em documentação, valide exemplos e links;
para mudanças no motor, execute os checks de `AGENTS.md`.

## Autoaperfeiçoamento pelo HII

### Separar as três responsabilidades

1. **Motor estável:** instalação que roda o daemon e mantém o estado operacional.
2. **Clone-alvo:** cópia do repositório HII registrada para receber melhorias.
3. **Worktree candidato:** criado pelo pipeline para cada tarefa do clone-alvo.

Não use o diretório de código do daemon como clone-alvo. Não rode `bun link` no
candidato: ele pode substituir o comando global. Não execute um segundo daemon
com os mesmos arquivos de estado. Mantenha o mesmo ambiente `HII_*` do motor
estável; mudar apenas um caminho pode misturar filas, locks e sessões.

Depois de este material estar disponível na base `main`, prepare um clone-alvo
separado. Antes do merge, as skills podem ser experimentadas diretamente na branch
do PR; o pipeline cria novos worktrees a partir da base registrada e não transporta
automaticamente as alterações ainda não integradas deste PR.

No **terminal WSL**, ajuste os dois caminhos ao ambiente real:

```bash
HII_MOTOR_ESTAVEL="$HOME/projects/hii"
HII_ALVO="$HOME/projects/hii-desenvolvimento"
git clone git@github.com:rafaelvpolan/hii.git "$HII_ALVO"
(cd "$HII_ALVO" && bun install --frozen-lockfile)

# Chama sempre a instalação estável, mesmo com outro cwd ou link global.
hii_estavel() {
  HII_ROOT="$HII_MOTOR_ESTAVEL" bun "$HII_MOTOR_ESTAVEL/bin/hii.ts" "$@"
}
hii_estavel repo list
```

Se o clone-alvo já existir, confira seu remoto/base e reutilize-o; não clone por
cima. Se `rafaelvpolan/hii` já estiver registrado, confira o caminho exibido. Não
remova nem redirecione um registro com tarefas em andamento. O próximo comando
é para um registro ainda ausente:

```bash
hii_estavel repo add rafaelvpolan/hii --path "$HII_ALVO" --branch main
hii_estavel pipeline doctor --repo rafaelvpolan/hii
hii_estavel status
```

`repo add` escreve o registro e provisiona o contrato local no alvo. O doctor é
diagnóstico de ambiente, não prova de que uma tarefa concluiu. Configure provedor
autenticado e limites adequados na instalação estável. Se o daemon estiver parado,
`hii_estavel start` inicia o processamento **de toda a fila elegível**; confira a
fila antes. Se estiver ativo, mantenha-o e abra `hii_estavel` para entrar na TUI.

Na **TUI do HII** (estes não são comandos do shell nem skills Codex):

```text
/repo rafaelvpolan/hii
/new autoaperfeicoamento
/hii docs/specs/autoaperfeicoamento-inicial.spec.md
```

O spec pede uma pequena melhoria documental com escopo e aceites definidos.
Leia-o antes de enviar. O conteúdo é capturado no envio; editar o arquivo depois
não muda a tarefa já criada. O teste real usa o provedor configurado e pode
consumir cota/custo. Não é um benchmark nem uma simulação gratuita.

Escrever a mesma tarefa como texto solto ou usar `hii task` cria gateway por
padrão: edição no checkout e conclusão do harness, sem o pipeline automático de
worktree, evidências e PR. Para este procedimento, use explicitamente `/hii`.

### Acompanhar e aceitar a entrega

- Anote o ID do card. Use `hii_estavel status`, a TUI e os registros da tarefa para
  conferir transições, custos e motivo de parada.
- Responda às aprovações solicitadas e confira o diff, verificações e PR. Ausência
  de comando verificável pode bloquear o critério; não o torne opcional só para passar.
- Para interromper, use `/stop <id>` na TUI. Após uma interrupção, inspecione o
  estado e o processo antes de retomar; não reenfileire cegamente outra cópia.
- Valide na branch candidata. O merge continua humano. Somente depois da revisão,
  merge e encerramento das tarefas em voo, atualize a instalação estável pelo seu
  procedimento de operação e reinicie deliberadamente. Não atualize o daemon no
  meio da tarefa que está produzindo sua nova versão.

## Validação offline do caminho

No worktree de desenvolvimento, estes testes existentes usam fixtures e verificam
contratos, retomada, evidências e leitura de spec, sem chamar IA paga ou a fila real:

```bash
node --test --test-timeout=60000 \
  test/oswaldo/orquestracao-contrato.test.ts \
  test/oswaldo/orquestracao-executar-plano.test.ts \
  test/oswaldo/orquestracao-evidencias.test.ts \
  test/oswaldo/orquestracao-pedido.test.ts
```

Isso não comprova o ciclo real com provedor e GitHub. A execução real termina com
o PR revisável e os resultados dos critérios da tarefa, não só com saída zero do
CLI. O motor mantém microtarefas seriais; não há autoatualização do daemon neste fluxo.

## Aproveitar o ECC seletivamente

Se o plugin ECC estiver carregado na sessão, use seus procedimentos de TDD ou
revisão para uma etapa específica. Preserve o HII como dono de estado, fila,
orçamento, worktree e liberação do PR. Não espelhe todo o catálogo nas pastas
`.agents`, `.codex`, `.claude` e `skills/`: isso duplica regras e mistura mecanismos.
Não inicie o launcher ECC de tmux/worktrees dentro de uma tarefa já orquestrada
sem um desenho explícito de isolamento e integração.

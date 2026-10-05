import type { EscopoDeEscrita } from '../oswaldo/rota/escopo.ts'
import { readContract } from '../cordel/bussola/armazenar.ts'
import { DESIGN_SYSTEM_BRIEF } from '../agentes/tarsila/design.ts'

export function roteamentoDeterministico(escolhidos: readonly string[]): string {
  return escolhidos.map(a => `${a} (escolhido pelo diff/contrato/titulo do card)`).join('; ')
}

export function stackOf(repo: string): string {
  const c = repo ? readContract(repo) : null
  return c?.stack ?? 'stack nao detectado — inspecione o projeto antes de editar'
}

// O bloco de escopo vai no TOPO do prompt, antes de qualquer contexto: e a unica
// instrucao cuja violacao o motor barra depois. Dizer no prompt nao basta — quem
// garante e a checagem do diff em motor/oswaldo/executar.ts —, mas o agente merece
// saber a regra antes de trabalhar em vez de descobrir no HALT.
export function blocoDeEscopo(e: EscopoDeEscrita): string {
  if (!e.alvos.length && !e.referencias.length) return ''
  // Cada linha diz a verdade sobre o que o motor faz com ela. A regra de LEITURA e
  // conferida no diff em dois pontos (oswaldo/executar.ts depois do implement,
  // quilombo/cartorio/fechar.ts contra origin/<base>) e para a tarefa. O "escreva somente em"
  // NAO e barrado: `foraDoEscopo` so barra escrita DENTRO de referencia declarada,
  // porque tratar todo caminho nao citado como proibido trocaria "editou onde nao
  // devia" por "nao consegue editar o import que precisava" — o primeiro aparece no
  // diff, o segundo parece motor quebrado. Anunciar cumprimento que nao existe seria
  // pior que nao anunciar: o modelo calibra pelo que a mensagem afirma.
  const linhas = ['ESCOPO DE ESCRITA (lido do pedido do humano):']
  if (e.alvos.length) linhas.push(`- O alvo do pedido e: ${e.alvos.join(', ')} — comece por ai e nao espalhe a mudanca sem necessidade.`)
  if (e.referencias.length) {
    linhas.push(`- SO LEITURA (nao edite, nao crie, nao apague nada aqui): ${e.referencias.join(', ')}`)
    linhas.push('  Estes caminhos sao REFERENCIA: leia deles o que precisar (cores, tokens, convencoes) e aplique no alvo.')
    linhas.push('  O motor CONFERE isto no diff e PARA a tarefa se for violado.')
  }
  return `${linhas.join('\n')}\n`
}

export function implementPrompt(agentesInjetados: readonly string[], agentesAdaptados: string, recursosSolicitados: string, workdir: string, desc: string, feedback: string, rules: string, visual: boolean, clarifications: string, refImages: string[], memory: string, stack: string, skills: string, escopo: EscopoDeEscrita, rotaContexto = ''): string {
  const refs = refImages.length
    ? `REFERENCIAS DE DESIGN (${refImages.length}): abra CADA imagem abaixo com a tool Read e replique o design o mais FIEL possivel (layout, cores, tipografia, espacamento, componentes); extraia os tokens a partir delas. Imagens:\n${refImages.map(p => `- ${p}`).join('\n')}\n`
    : ''
  const head = agentesInjetados.length
    ? [
        'O HII orquestra esta execucao; use os AGENTES NEXUS para implementar a tarefa abaixo no projeto-alvo indicado.',
        `O codigo a alterar fica em: ${workdir} — ${stack}. Edite os arquivos DESSE diretorio.`,
        `Use via Task exatamente estes: ${roteamentoDeterministico(agentesInjetados)}. A escolha ja foi feita pelo motor — nao substitua por outro agente. NAO rode crivo/review nesta etapa (nao chame o crivo): a revisao adversarial e os gates rodam DEPOIS, na fase de polimento do motor. Apenas implemente.`,
      ]
    : [
        'O HII orquestra esta execucao. Implemente a tarefa abaixo somente no projeto-alvo indicado.',
        `O codigo a alterar fica em: ${workdir} — ${stack}. Edite os arquivos DESSE diretorio.`,
      ]
  return [
    blocoDeEscopo(escopo),
    rules ? `CONTEXTO DO PROJETO (.hii/rules.md — respeite):\n${rules}\n` : '',
    skills ? `${skills}\n` : '',
    agentesAdaptados ? `${agentesAdaptados}\n` : '',
    recursosSolicitados ? `${recursosSolicitados}\n` : '',
    memory ? `MEMORIA DO PROJETO (.hii/memory — decisoes/convencoes acumuladas, respeite):\n${memory}\n` : '',
    rotaContexto ? `CONTEXTO PRESERVADO NA TROCA DE IA:\n${rotaContexto}\n` : '',
    clarifications ? clarifications : '',
    refs,
    visual ? `${DESIGN_SYSTEM_BRIEF}\n` : '',
    ...head,
    'Faca a MENOR mudanca que cumpra a tarefa. NAO rode git, NAO faca commit, NAO inicie servidores. Sem comentarios de prosa.',
    feedback ? `\nATENCAO (reexecucao): ${feedback}` : '',
    '',
    'TAREFA:',
    desc ?? '',
    '',
    'Ao terminar, responda em 1 linha: qual agente atuou e o que mudou.',
  ].join('\n')
}

export function acaoExternaPrompt(ferramenta: string, desc: string, feedback: string): string {
  return [
    `Esta tarefa e uma ACAO EXTERNA em ${ferramenta}, executada pelo conector MCP (tools mcp__*). NAO ha codigo a alterar: NAO edite nenhum arquivo deste repositorio e NAO chame agentes Nexus (Task).`,
    'Antes de escrever, localize o destino correto (pagina ou database pai) usando as tools MCP disponiveis. So entao execute a acao pedida.',
    feedback ? `ATENCAO (reexecucao): ${feedback}` : '',
    '',
    'TAREFA:',
    desc ?? '',
    '',
    'Ao terminar, responda em 1 linha o que foi criado e o link ou ID do resultado.',
  ].filter(Boolean).join('\n')
}

// O escopo e lido do PEDIDO, com checagem de existencia contra o worktree — prosa
// com barra ("feito/executado em ...") nao vira caminho.

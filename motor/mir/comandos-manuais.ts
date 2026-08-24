import { carregarAcervo } from '../csd/acervo.ts'
import type { Skill } from '../csd/acervo.ts'

// MIR — item 16. Os comandos manuais sao ATALHOS DE INTAKE, e a distincao nao e
// cosmetica: eles pre-carregam CONTEUDO diferente e rodam O MESMO pipeline. Um
// comando que criasse caminho de execucao proprio seria um segundo motor com
// gates proprios, e os gates do primeiro deixariam de valer para metade do
// trabalho.
//
// POR QUE EXISTEM. A escolha de skill e por gatilho deterministico em disco:
// arquivo tocado e dependencia detectada. Projeto greenfield nao tem nem um nem
// outro — o card nasce sem arquivo e sem contrato, entao so as skills
// `sempre: true` carregam e o dominio inteiro fica de fora. Declarar o pack e a
// unica informacao que existe no intake e ainda nao existe no disco.
//
// POR QUE FICARAM ADIADOS ATE AGORA. Os packs `backend-web`, `mobile` e
// `devops-deploy` nao existiam. Ligar os comandos antes deles criaria atalho que
// pre-carrega vazio — pior que nao ter o atalho, porque parece que carregou.
// A guarda contra isso e `validarComandosManuais()`, que LANCA se um comando
// apontar para pack que nao esta no acervo.

export interface ComandoManual {
  readonly nome: string
  readonly packs: readonly string[]
  readonly descricao: string
  // `/layout` nao pre-carrega pack: ele liga o modo de entrada da Fase 3.
  readonly ligaLayout?: boolean
}

export const COMANDOS_MANUAIS: readonly ComandoManual[] = [
  {
    nome: '/orquestrador-jogos',
    packs: ['common', 'games-multiplatform'],
    descricao: 'jogo — engine, netcode, replay determinista, build multiplataforma',
  },
  {
    nome: '/orquestrador-dev-web',
    packs: ['common', 'frontend-web', 'backend-web'],
    descricao: 'web — front (padroes, a11y, SEO) e back (persistencia, resiliencia, fila, observabilidade)',
  },
  {
    nome: '/orquestrador-android',
    packs: ['common', 'mobile'],
    descricao: 'mobile — Android/Kotlin, iOS/Swift, multiplataforma e publicacao em loja',
  },
  {
    nome: '/orquestrador-devops',
    packs: ['common', 'devops-deploy'],
    descricao: 'infra — pipeline, imagem de conteiner, estrategia de deploy, SLO e alerta',
  },
  {
    nome: '/layout',
    packs: ['common', 'frontend-web'],
    descricao: 'entrada padrao da Fase 3 para trabalho visual — liga o modo layout no card',
    ligaLayout: true,
  },
]

export const NOMES_DE_COMANDO_MANUAL: readonly string[] = COMANDOS_MANUAIS.map(c => c.nome)

export function comandoManual(nome: string): ComandoManual | undefined {
  return COMANDOS_MANUAIS.find(c => c.nome === nome)
}

export interface PackAusente {
  readonly comando: string
  readonly pack: string
}

export function packsAusentes(acervo: readonly Skill[] = carregarAcervo()): PackAusente[] {
  const existentes = new Set(acervo.map(s => s.pack))
  return COMANDOS_MANUAIS.flatMap(c =>
    c.packs.filter(p => !existentes.has(p)).map(p => ({ comando: c.nome, pack: p })))
}

// Chamada no arranque do daemon (runner.ts, logo depois de warnProviderConfig) e
// no teste. LANCA de proposito: atalho que pre-carrega vazio e a falha silenciosa
// que este item passou tres ondas evitando. Quem chama no arranque converte o
// lance em aviso — derrubar o motor por causa de um atalho seria pior.
export function validarComandosManuais(acervo: readonly Skill[] = carregarAcervo()): void {
  const ausentes = packsAusentes(acervo)
  if (ausentes.length) {
    const lista = ausentes.map(a => `${a.comando} -> "${a.pack}"`).join(', ')
    throw new Error(`comando manual aponta para pack que nao existe no acervo: ${lista} — atalho que pre-carrega vazio parece que carregou alguma coisa`)
  }
}

export interface IntakeManual {
  readonly comando: string
  readonly packs: readonly string[]
  readonly texto: string
  readonly layout: boolean
}

// Devolve null para qualquer coisa que nao seja comando manual — quem chama
// segue o fluxo normal. Nao lanca aqui: linha desconhecida e caso comum, e o
// erro de comando inexistente e do reducer da sessao, num lugar so.
export function interpretarIntake(linha: string): IntakeManual | null {
  const bruto = linha.trim()
  if (!bruto.startsWith('/')) return null
  const [cabeca, ...resto] = bruto.split(/\s+/)
  const c = comandoManual(cabeca ?? '')
  if (!c) return null
  return {
    comando: c.nome,
    packs: c.packs,
    texto: resto.join(' ').trim(),
    layout: c.ligaLayout === true,
  }
}

// Os campos que o card ganha. Vao para o MESMO createCard que qualquer outra
// tarefa usa: o que muda e o conteudo carregado, nunca o caminho.
export function camposDoIntake(i: IntakeManual): Record<string, string> {
  const campos: Record<string, string> = { packs: i.packs.join(',') }
  if (i.layout) campos.layout = 'on'
  return campos
}

// Le o campo do card de volta. Campo ausente vira lista vazia, e lista vazia
// faz o gatilho por arquivo decidir sozinho — que e o comportamento de sempre.
export function packsDoCard(valor: string | undefined): string[] {
  return (valor ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

// O /help da TUI monta os atalhos direto de COMANDOS_MANUAIS
// (motor/mir/render/help.ts), que e a mesma fonte. Esta funcao existe para a saida
// de UMA LINHA por atalho, usada por `hii --help` no terminal.
export function ajudaDeComandosManuais(): string[] {
  return COMANDOS_MANUAIS.map(c => `  ${c.nome.padEnd(24)} ${c.descricao}`)
}

export interface ComandoDeCriterio {
  binario: string
  argumentos: string[]
  diretorio: string
  timeoutMs: number
}

export interface CriterioDoPlano {
  id: string
  descricao: string
  obrigatorio: boolean
  comando?: ComandoDeCriterio
  naoAplicavel?: string
}

export interface Microtask {
  id: string
  titulo: string
  instrucao: string
  agente: string
  ia?: { provedor: string; modelo?: string }
  dependeDe: string[]
  arquivos: string[]
  criterios: string[]
}

export interface PlanoDeExecucao {
  versao: 1
  id: string
  repo: string
  sessaoId: string
  objetivo: string
  epicoId?: string
  produtoId?: string
  risco: 'low' | 'high'
  criterios: CriterioDoPlano[]
  microtasks: Microtask[]
  rollout: { ativacao: string; sucesso: string; interrupcao: string; reversao: string }
}

export class ErroDeContrato extends Error {
  readonly codigo: string
  readonly campo: string
  constructor(codigo: string, campo: string, mensagem: string) {
    super(`${campo}: ${mensagem}`)
    this.codigo = codigo
    this.campo = campo
    this.name = 'ErroDeContrato'
  }
}

function exigir(condicao: boolean, campo: string, mensagem: string): void {
  if (!condicao) throw new ErroDeContrato('invalido', campo, mensagem)
}

export function idValido(id: string): boolean {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)
}

function texto(valor: string): boolean {
  return typeof valor === 'string' && valor.trim().length > 0
}

function lista(valor: string[]): boolean {
  return Array.isArray(valor) && valor.every(texto) && new Set(valor).size === valor.length
}

function relativo(caminho: string): boolean {
  return typeof caminho === 'string' && !/^(?:[\\/]|[a-z]:)/i.test(caminho) && !caminho.includes('\0') && !caminho.split(/[\\/]/).includes('..')
}

export function ondasEstritas(microtasks: readonly Microtask[]): Microtask[][] {
  const ids = new Set(microtasks.map(m => m.id))
  exigir(ids.size === microtasks.length, 'microtasks', 'IDs duplicados')
  for (const m of microtasks) {
    exigir(lista(m.dependeDe), `microtasks.${m.id}.dependeDe`, 'lista invalida ou duplicada')
    for (const dep of m.dependeDe) exigir(ids.has(dep), `microtasks.${m.id}.dependeDe`, `referencia ausente: ${dep}`)
  }
  const feitas = new Set<string>()
  const ondas: Microtask[][] = []
  while (feitas.size < ids.size) {
    const pendentes = microtasks.filter(m => !feitas.has(m.id))
    const prontas = pendentes.filter(m => m.dependeDe.every(d => feitas.has(d)))
    exigir(prontas.length > 0, 'microtasks.dependeDe', `ciclo: ${pendentes.map(m => m.id).join(', ')}`)
    ondas.push(prontas)
    for (const m of prontas) feitas.add(m.id)
  }
  return ondas
}

export function validarPlano(plano: PlanoDeExecucao): PlanoDeExecucao {
  exigir(!!plano && typeof plano === 'object' && !Array.isArray(plano), 'plano', 'objeto obrigatorio')
  if (plano.versao !== 1) throw new ErroDeContrato('versao-incompativel', 'versao', 'suportada: 1')
  exigir(idValido(plano.id), 'id', 'ID invalido')
  exigir(idValido(plano.sessaoId), 'sessaoId', 'ID invalido')
  exigir(texto(plano.repo) && /^[^\s/]+\/[^\s/]+(?:\/[^\s/]+)?$/.test(plano.repo), 'repo', 'use owner/repo')
  exigir(texto(plano.objetivo), 'objetivo', 'obrigatorio')
  exigir(plano.risco === 'low' || plano.risco === 'high', 'risco', 'use low ou high')
  exigir(Array.isArray(plano.criterios) && plano.criterios.length > 0, 'criterios', 'ao menos um criterio')
  const criterios = new Set<string>()
  for (const c of plano.criterios) {
    exigir(!!c && idValido(c.id) && !criterios.has(c.id), 'criterios.id', 'ID invalido ou duplicado')
    criterios.add(c.id)
    exigir(texto(c.descricao) && typeof c.obrigatorio === 'boolean', `criterios.${c.id}`, 'descricao e obrigatoriedade necessarias')
    if (c.naoAplicavel !== undefined) exigir(texto(c.naoAplicavel), `criterios.${c.id}.naoAplicavel`, 'justifique')
    if (c.comando) {
      const cmd = c.comando
      exigir(texto(cmd.binario) && Array.isArray(cmd.argumentos) && cmd.argumentos.every(a => typeof a === 'string'), `criterios.${c.id}.comando`, 'binario e argumentos invalidos')
      exigir(relativo(cmd.diretorio), `criterios.${c.id}.diretorio`, 'use caminho relativo dentro do worktree')
      exigir(Number.isInteger(cmd.timeoutMs) && cmd.timeoutMs > 0 && cmd.timeoutMs <= 900000, `criterios.${c.id}.timeoutMs`, 'intervalo permitido: 1-900000')
    }
  }
  exigir(Array.isArray(plano.microtasks) && plano.microtasks.length > 0, 'microtasks', 'ao menos uma microtask')
  for (const m of plano.microtasks) {
    exigir(!!m && idValido(m.id) && texto(m.titulo) && texto(m.instrucao) && texto(m.agente), 'microtasks', 'ID, titulo, instrucao e agente obrigatorios')
    if (m.ia !== undefined) {
      exigir(!!m.ia && typeof m.ia === 'object' && !Array.isArray(m.ia), `microtasks.${m.id}.ia`, 'objeto obrigatorio')
      exigir(texto(m.ia.provedor), `microtasks.${m.id}.ia.provedor`, 'provedor obrigatorio')
      if (m.ia.modelo !== undefined) exigir(texto(m.ia.modelo), `microtasks.${m.id}.ia.modelo`, 'modelo nao pode ser vazio')
    }
    exigir(lista(m.arquivos) && m.arquivos.every(relativo), `microtasks.${m.id}.arquivos`, 'caminhos relativos sem duplicacao')
    exigir(lista(m.criterios) && m.criterios.length > 0 && m.criterios.every(c => criterios.has(c)), `microtasks.${m.id}.criterios`, 'referencia a criterio ausente ou lista vazia')
  }
  ondasEstritas(plano.microtasks)
  exigir(!!plano.rollout && ['ativacao', 'sucesso', 'interrupcao', 'reversao'].every(k => texto(plano.rollout[k as keyof PlanoDeExecucao['rollout']])), 'rollout', 'ativacao, sucesso, interrupcao e reversao obrigatorios')
  exigir(contarLinhas(JSON.stringify(plano, null, 2)) <= 500, 'plano', 'limite de 500 linhas; divida o planejamento')
  return plano
}

export function contarLinhas(documento: string): number {
  return documento.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length
}

export function lerDocumentoDePlano(documento: string): PlanoDeExecucao {
  exigir(contarLinhas(documento) <= 500, 'plano', 'limite de 500 linhas; documento nao sera truncado')
  return validarPlano(JSON.parse(documento) as PlanoDeExecucao)
}

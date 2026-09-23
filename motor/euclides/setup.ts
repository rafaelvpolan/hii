import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, writeFileSync, realpathSync, unlinkSync, rmdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { arquivosIniciaisDoHome } from '../cordel/alicerce/home.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'

interface EstadoDoArquivo { tipo: 'ausente' | 'arquivo' | 'diretorio'; hash: string; dev: number; ino: number }
export interface PassoDeSetup { id: string; caminho: string; tipo: 'arquivo' | 'diretorio'; conteudo: string }
export interface PlanoDeSetup {
  versao: 1; raiz: string; identidade: { dev: number; ino: number }; hash: string
  passos: PassoDeSetup[]; observacoes: Record<string, EstadoDoArquivo>
}
interface Recibo {
  estado: 'iniciada' | 'aplicada' | 'reconciliada' | 'revertida' | 'preservada'
  depois?: EstadoDoArquivo; motivo?: string
}
interface Diario { versao: 1; plano: PlanoDeSetup; selecao: string[]; recibos: Record<string, Recibo>; falha: string }
export interface ResultadoDeSetup { ok: boolean; linhas: string[] }
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
function estado(caminho: string): EstadoDoArquivo {
  try {
    const s = lstatSync(caminho)
    if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) throw new Error('setup recusa symlink ou arquivo especial: ' + caminho)
    return { tipo: s.isDirectory() ? 'diretorio' : 'arquivo', hash: s.isFile() ? sha(readFileSync(caminho, 'utf8')) : '', dev: s.dev, ino: s.ino }
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return { tipo: 'ausente', hash: '', dev: 0, ino: 0 }
    throw erro
  }
}
function catalogo(): PassoDeSetup[] {
  return [
    ...['', 'memory', 'skills', 'state'].map((nome): PassoDeSetup => ({ id: nome || 'home', caminho: '.hii' + (nome ? '/' + nome : ''), tipo: 'diretorio', conteudo: '' })),
    ...arquivosIniciaisDoHome().map(([nome, conteudo]): PassoDeSetup => ({ id: nome === '.gitignore' ? 'ignore' : nome.split('.')[0]!, caminho: '.hii/' + nome, tipo: 'arquivo', conteudo })),
  ]
}
function alvo(plano: PlanoDeSetup, passo: PassoDeSetup): string {
  if (!catalogo().some(p => p.id === passo.id && p.caminho === passo.caminho && p.tipo === passo.tipo && p.conteudo === passo.conteudo)) throw new Error('passo de setup fora do catalogo revisado')
  const raiz = lstatSync(plano.raiz)
  if (raiz.isSymbolicLink() || !raiz.isDirectory() || raiz.dev !== plano.identidade.dev || raiz.ino !== plano.identidade.ino || realpathSync(plano.raiz) !== plano.raiz) throw new Error('raiz do projeto foi substituida')
  const partes = passo.caminho.split('/')
  for (let i = 1; i <= partes.length; i++) estado(join(plano.raiz, ...partes.slice(0, i)))
  return join(plano.raiz, passo.caminho)
}
function arquivo(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('hash de plano invalido')
  return join(cardsDir(), 'setup', hash + '.json')
}
function salvar(d: Diario): void { writeFileAtomic(arquivo(d.plano.hash), JSON.stringify(d, null, 2) + '\n') }
function conferirPlano(p: PlanoDeSetup, repo: string): void {
  const { hash, ...base } = p
  if (p.versao !== 1 || p.raiz !== realpathSync(repo) || hash !== sha(JSON.stringify(base))) throw new Error('plano pertence a outra raiz ou foi adulterado')
  for (const passo of p.passos) alvo(p, passo)
}
function ler(hash: string, repo: string): Diario {
  const d = JSON.parse(readFileSync(arquivo(hash), 'utf8')) as Diario
  if (d.versao !== 1 || d.plano.hash !== hash) throw new Error('diario de setup invalido')
  conferirPlano(d.plano, repo)
  return d
}
export function planejarSetup(repo: string): PlanoDeSetup {
  const raiz = realpathSync(repo)
  const s = lstatSync(raiz)
  if (!s.isDirectory()) throw new Error('projeto nao e um diretorio')
  if (estado(join(raiz, '.hii')).tipo === 'ausente' && estado(join(raiz, '.hicode')).tipo !== 'ausente') throw new Error('memoria .hicode legada encontrada; reconciliar a migracao antes de aplicar scaffold .hii')
  const observacoes: Record<string, EstadoDoArquivo> = {}
  const passos: PassoDeSetup[] = []
  for (const passo of catalogo()) {
    // Conferir cada ancestral antes de ler conteudo.
    const caminho = join(raiz, passo.caminho)
    if (passo.caminho !== '.hii') estado(join(raiz, '.hii'))
    const atual = estado(caminho)
    if (atual.tipo !== 'ausente' && atual.tipo !== passo.tipo) throw new Error('tipo de arquivo incompativel: ' + passo.caminho)
    observacoes[passo.caminho] = atual
    if (atual.tipo === 'ausente') passos.push(passo)
  }
  const base = { versao: 1 as const, raiz, identidade: { dev: s.dev, ino: s.ino }, passos, observacoes }
  return { ...base, hash: sha(JSON.stringify(base)) }
}
export function registrarPlanoSetup(plano: PlanoDeSetup): void {
  conferirPlano(plano, plano.raiz)
  const f = arquivo(plano.hash)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
  withFileLock(f, () => {
    if (estado(f).tipo === 'ausente') writeFileSync(f, JSON.stringify({ versao: 1, plano, selecao: [], recibos: {}, falha: '' }), { flag: 'wx', mode: 0o600 })
    else ler(plano.hash, plano.raiz)
  })
}
function mesmo(a: EstadoDoArquivo, b: EstadoDoArquivo): boolean {
  return a.tipo === b.tipo && a.hash === b.hash && a.dev === b.dev && a.ino === b.ino
}
function efeitoEsperado(passo: PassoDeSetup, atual: EstadoDoArquivo): boolean {
  return atual.tipo === passo.tipo && (passo.tipo === 'diretorio' || atual.hash === sha(passo.conteudo))
}
export function efetuarPassoSetup(passo: PassoDeSetup, caminho: string): void {
  if (passo.tipo === 'diretorio') mkdirSync(caminho)
  else writeFileSync(caminho, passo.conteudo, { flag: 'wx', mode: 0o600 })
}
export function aplicarSetup(hash: string, repo: string, ids?: string[], efetuar: typeof efetuarPassoSetup = efetuarPassoSetup): ResultadoDeSetup {
  return withFileLock(arquivo(hash), () => {
    const d = ler(hash, repo)
    const selecionados = ids ?? d.plano.passos.map(p => p.id)
    if (selecionados.some(id => !d.plano.passos.some(p => p.id === id)) || new Set(selecionados).size !== selecionados.length) throw new Error('selecao de passos invalida')
    const conjunto = new Set(selecionados)
    if (selecionados.length && d.plano.passos.some(p => p.id === 'home')) conjunto.add('home')
    const selecao = d.plano.passos.filter(p => conjunto.has(p.id)).map(p => p.id)
    if (d.selecao.length && JSON.stringify(d.selecao) !== JSON.stringify(selecao)) throw new Error('este plano ja possui outra selecao; gere novo plano')
    if (Object.values(d.recibos).some(r => r.estado === 'revertida' || r.estado === 'preservada')) throw new Error('plano ja revertido; gere outro plano antes de aplicar')
    const linhas: string[] = []
    try {
      if (!d.selecao.length) {
        for (const [rel, antes] of Object.entries(d.plano.observacoes)) {
          if (!mesmo(estado(join(d.plano.raiz, rel)), antes)) throw new Error('projeto mudou depois da previa: ' + rel)
        }
        d.selecao = selecao
        salvar(d)
      }
      for (const passo of d.plano.passos.filter(p => conjunto.has(p.id))) {
        const caminho = alvo(d.plano, passo)
        const recibo = d.recibos[passo.id]
        if (recibo && recibo.estado !== 'iniciada') { linhas.push(passo.id + ': ja aplicado; sem sobrescrita'); continue }
        const atual = estado(caminho)
        if (recibo?.estado === 'iniciada' && efeitoEsperado(passo, atual)) {
          d.recibos[passo.id] = { estado: 'reconciliada', depois: atual, motivo: 'efeito encontrado apos interrupcao; ownership nao comprovado para reversao' }
          salvar(d); linhas.push(passo.id + ': reconciliado, arquivo preservado'); continue
        }
        if (atual.tipo !== 'ausente') throw new Error('efeito divergente ou arquivo criado depois da previa: ' + passo.caminho)
        d.recibos[passo.id] = { estado: 'iniciada' }
        salvar(d)
        efetuar(passo, caminho)
        const depois = estado(caminho)
        if (!efeitoEsperado(passo, depois)) throw new Error('efeito de setup nao confirmado: ' + passo.id)
        d.recibos[passo.id] = { estado: 'aplicada', depois }
        salvar(d)
        linhas.push(passo.id + ': aplicado')
      }
      d.falha = ''; salvar(d)
      return { ok: true, linhas: linhas.length ? linhas : ['setup ja atendido; nenhum arquivo alterado'] }
    } catch (erro) {
      d.falha = (erro as Error).message
      salvar(d)
      return { ok: false, linhas: [...linhas, 'setup parcial ou recusado: ' + d.falha, 'diario preservado; repita o mesmo hash para reconciliar ou use undo'] }
    }
  })
}
export function reverterSetup(hash: string, repo: string): ResultadoDeSetup {
  return withFileLock(arquivo(hash), () => {
    const d = ler(hash, repo)
    const linhas: string[] = []
    let ok = true
    for (const passo of [...d.plano.passos].reverse()) {
      const recibo = d.recibos[passo.id]
      if (!recibo || recibo.estado === 'revertida') continue
      const caminho = alvo(d.plano, passo)
      const atual = estado(caminho)
      if (atual.tipo === 'ausente') { recibo.estado = 'revertida'; salvar(d); continue }
      if (recibo.estado !== 'aplicada' || !recibo.depois || !mesmo(atual, recibo.depois)) {
        recibo.estado = 'preservada'; recibo.motivo = 'alteracao posterior ou ownership incerto'
        linhas.push(passo.id + ': preservado — ' + recibo.motivo); ok = false; salvar(d); continue
      }
      try {
        // Nunca remove recursivamente: diretorio com qualquer arquivo novo permanece.
        if (passo.tipo === 'diretorio') rmdirSync(caminho)
        else unlinkSync(caminho)
        recibo.estado = 'revertida'; salvar(d); linhas.push(passo.id + ': revertido')
      } catch (erro) {
        recibo.estado = 'preservada'; recibo.motivo = (erro as NodeJS.ErrnoException).code || 'falha de reversao'
        linhas.push(passo.id + ': preservado — ' + recibo.motivo); ok = false; salvar(d)
      }
    }
    return { ok, linhas: linhas.length ? linhas : ['nenhum efeito pendente de reversao'] }
  })
}

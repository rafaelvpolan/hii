import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GATE_DIFF_LIMIT, ROOT } from '../../cdl/ali/config'
import { runGit } from '../../qlb/git'

export const EXT_AUDITAVEL = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'py'])

const ORCAMENTO_FALLBACK = 60000

function orcamentoValido(valor: number, fallback: number): number {
  const n = Math.floor(valor)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

function tetoDeLotes(valor: number): number {
  const n = Math.floor(valor)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const LOTE_CHARS_DEFAULT = orcamentoValido(
  Number(process.env.HICODE_AUDIT_LOTE_CHARS || GATE_DIFF_LIMIT),
  ORCAMENTO_FALLBACK,
)

const DIR_GERADO = ['node_modules/', 'dist/', 'build/', 'coverage/', 'vendor/', '.nuxt/', '.output/', '.git/']
const EXT_SEM_EXPORT = new Set(['py'])
const ALLOW_MONOLITO = /hicode:allow-monolith/
const MAX_LINHAS = 350
const GOD_FUNCS = 20
const GOD_EXPORTS = 3
const PESO_MONOLITO = 60
const PESO_GOD_FILE = 50
const PESO_SEM_TESTE = 25
const PESO_POR_LINHA = 0.1
const FATOR_TESTE = 0.6

export type MotivoFora =
  | 'extensao-nao-auditavel'
  | 'diretorio-gerado'
  | 'arquivo-vazio'
  | 'ilegivel'
  | 'maior-que-o-lote'
  | 'acima-do-limite-de-lotes'

export type Gravidade = 'alta' | 'media' | 'baixa'

export interface ForaDaAuditoria {
  path: string
  motivo: MotivoFora
  detalhe: string
}

export interface ArquivoAuditavel {
  path: string
  chars: number
  linhas: number
  funcoes: number
  exports: number
  excedeLinhas: boolean
  godFile: boolean
  semTeste: boolean
  risco: number
  motivos: string[]
}

export interface LoteAuditoria {
  indice: number
  arquivos: ArquivoAuditavel[]
  chars: number
}

export interface PlanoAuditoria {
  lotes: LoteAuditoria[]
  fora: ForaDaAuditoria[]
  totalListado: number
  totalAuditado: number
  orcamentoChars: number
  escopo: string
}

export interface OpcoesAuditoria {
  raiz?: string
  listar?: () => Promise<string[]>
  ler?: (path: string) => string | null
  orcamentoChars?: number
  maxLotes?: number
  escopo?: string
}

export interface AchadoAuditoria {
  path: string
  gravidade: Gravidade
  resumo: string
  lote: number
  linha?: number
}

export interface GrupoFora {
  motivo: MotivoFora
  label: string
  quantidade: number
  paths: string[]
}

const LABEL_FORA: Record<MotivoFora, string> = {
  'extensao-nao-auditavel': 'nao e codigo auditavel (config/IaC/docs/binario)',
  'diretorio-gerado': 'diretorio gerado ou vendor',
  'arquivo-vazio': 'arquivo sem conteudo util',
  'ilegivel': 'nao foi possivel ler como texto',
  'maior-que-o-lote': 'arquivo maior que o orcamento de um lote',
  'acima-do-limite-de-lotes': 'cortado pelo limite de lotes desta execucao',
}

const RANK_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 }

export async function listarRastreados(raiz: string): Promise<string[]> {
  const r = await runGit(raiz, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  if (r.err) throw new Error(`git ls-files falhou em ${raiz}: ${r.stderr.trim() || r.err.message}`)
  return r.stdout.split('\0').filter(s => s.length > 0)
}

function lerTexto(raiz: string, path: string): string | null {
  try {
    return readFileSync(join(raiz, path), 'utf8')
  } catch {
    return null
  }
}

function extensaoDe(path: string): string {
  const base = path.split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

function stemDe(path: string): string {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  return base.replace(/\.(test|spec)\./, '.').replace(/\.[^.]+$/, '')
}

export function ehArquivoDeTeste(path: string): boolean {
  const p = path.toLowerCase()
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p) || /_test\.py$/.test(p)
}

function scriptDeVue(text: string): string {
  const blocos = text.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)
  if (!blocos) return ''
  return blocos.map(b => b.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '')).join('\n')
}

function linhasDeCodigo(text: string): number {
  return text.split('\n').filter(l => l.trim() !== '').length
}

function contaFuncoes(text: string): number {
  const declaradas = (text.match(/\bfunction\b/g) ?? []).length
  const setas = (text.match(/\b(?:const|let|var)\s+[\w$]+\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=\n]+)?=>/g) ?? []).length
  const python = (text.match(/^\s*def\s+\w+/gm) ?? []).length
  return declaradas + setas + python
}

function contaExports(text: string): number {
  return (text.match(/\bexport\b/g) ?? []).length + (text.match(/\bmodule\.exports\b/g) ?? []).length
}

export function stemsDeTeste(paths: string[]): Set<string> {
  const stems = new Set<string>()
  for (const p of paths) {
    if (ehArquivoDeTeste(p)) stems.add(stemDe(p))
  }
  return stems
}

const ESPECIFICADOR = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.[^'"\n]*)\1/g
const EXT_DE_MODULO = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.vue']

function normalizar(caminho: string): string {
  const partes: string[] = []
  for (const parte of caminho.split('/')) {
    if (!parte || parte === '.') continue
    if (parte === '..') { partes.pop(); continue }
    partes.push(parte)
  }
  return partes.join('/')
}

// Resolve o especificador contra a LISTA de arquivos do repo, sem tocar no
// disco: a auditoria ja recebe tudo que esta rastreado.
function alvoDoImport(deArquivo: string, spec: string, existentes: ReadonlySet<string>): string | null {
  const dir = deArquivo.split('/').slice(0, -1).join('/')
  const base = normalizar(`${dir}/${spec}`)
  if (existentes.has(base)) return base
  for (const e of EXT_DE_MODULO) if (existentes.has(base + e)) return base + e
  for (const e of EXT_DE_MODULO) if (existentes.has(`${base}/index${e}`)) return `${base}/index${e}`
  return null
}

export interface CoberturaDeTeste {
  // caminhos que ALGUM arquivo de teste importa, direta ou dinamicamente
  readonly importados: ReadonlySet<string>
  // fallback por nome, para o que import nao alcanca (python, vue, fixture)
  readonly stems: ReadonlySet<string>
}

// Por que import e nao nome: o casamento por stem quebra no instante em que o
// fonte e renomeado sem renomear o teste — foi o que a Onda 1 fez com 172
// arquivos, e o auditor passou a reportar "sem teste" para arquivo que TEM
// teste. Import e a relacao real; nome e uma convencao que envelhece.
export function coberturaDeTeste(listados: string[], ler: (p: string) => string | null): CoberturaDeTeste {
  const existentes = new Set(listados)
  const importados = new Set<string>()
  for (const p of listados) {
    if (!ehArquivoDeTeste(p)) continue
    const texto = ler(p)
    if (texto === null) continue
    for (const m of texto.matchAll(ESPECIFICADOR)) {
      const spec = m[2]
      if (!spec) continue
      const alvo = alvoDoImport(p, spec, existentes)
      if (alvo && !ehArquivoDeTeste(alvo)) importados.add(alvo)
    }
  }
  return { importados, stems: stemsDeTeste(listados) }
}

export function temTesteCorrespondente(path: string, cobertura: CoberturaDeTeste | Set<string>): boolean {
  if (ehArquivoDeTeste(path)) return true
  const stems = cobertura instanceof Set ? cobertura : cobertura.stems
  if (!(cobertura instanceof Set) && cobertura.importados.has(path)) return true
  const alvo = stemDe(path)
  if (!alvo) return false
  for (const s of stems) {
    if (casaPorNome(s, alvo)) return true
  }
  return false
}

// `-` e `_` valem como o mesmo separador. Antes so `-` contava, o que fazia
// tests/servico_test.py nunca casar com app/servico.py — o fallback para
// Python estava morto desde sempre, sem ninguem notar.
function casaPorNome(stemDoTeste: string, alvo: string): boolean {
  const t = stemDoTeste.replace(/_/g, '-')
  const a = alvo.replace(/_/g, '-')
  return t === a || t.startsWith(`${a}-`) || t.endsWith(`-${a}`) || t.includes(`-${a}-`)
}

function metricasDe(path: string, texto: string, cobertura: CoberturaDeTeste): ArquivoAuditavel {
  const ext = extensaoDe(path)
  const codigo = ext === 'vue' ? scriptDeVue(texto) : texto
  const linhas = linhasDeCodigo(codigo)
  const funcoes = contaFuncoes(codigo)
  const exports = contaExports(codigo)
  const excedeLinhas = linhas > MAX_LINHAS
  const godFile = !EXT_SEM_EXPORT.has(ext) && funcoes >= GOD_FUNCS && exports < GOD_EXPORTS
  const ehTeste = ehArquivoDeTeste(path)
  const semTeste = !temTesteCorrespondente(path, cobertura)
  const sancionado = ALLOW_MONOLITO.test(texto) && (excedeLinhas || godFile)
  const motivos: string[] = []
  if (excedeLinhas) motivos.push(`monolito: ${linhas} linhas (limite ${MAX_LINHAS})`)
  if (godFile) motivos.push(`god-file: ${funcoes} funcoes e ${exports} export(s)`)
  if (sancionado) motivos.push('divida assumida via hicode:allow-monolith — o hook do repo nao bloqueia este arquivo')
  if (semTeste) motivos.push('sem teste correspondente')
  if (ehTeste) motivos.push('arquivo de teste — risco reduzido, codigo de producao vem antes')
  const bruto =
    (excedeLinhas && !sancionado ? PESO_MONOLITO : 0) +
    (godFile && !sancionado ? PESO_GOD_FILE : 0) +
    (semTeste ? PESO_SEM_TESTE : 0) +
    Math.round(linhas * PESO_POR_LINHA * 10) / 10
  const risco = Math.round(bruto * (ehTeste ? FATOR_TESTE : 1) * 10) / 10
  return { path, chars: texto.length, linhas, funcoes, exports, excedeLinhas, godFile, semTeste, risco, motivos }
}

function rejeitarPorCaminho(path: string): Omit<ForaDaAuditoria, 'path'> | null {
  const p = path.toLowerCase()
  for (const dir of DIR_GERADO) {
    if (p.startsWith(dir) || p.includes(`/${dir}`)) return { motivo: 'diretorio-gerado', detalhe: `dentro de ${dir}` }
  }
  if (/\.d\.[cm]?ts$/.test(p)) return { motivo: 'extensao-nao-auditavel', detalhe: 'declaracao de tipos (.d.ts)' }
  const ext = extensaoDe(path)
  if (!EXT_AUDITAVEL.has(ext)) return { motivo: 'extensao-nao-auditavel', detalhe: ext ? `extensao .${ext}` : 'sem extensao' }
  return null
}

export function ordenarPorRisco(arquivos: ArquivoAuditavel[]): ArquivoAuditavel[] {
  return [...arquivos].sort((a, b) => (b.risco - a.risco) || (b.chars - a.chars) || a.path.localeCompare(b.path))
}

function montarLotes(arquivos: ArquivoAuditavel[], orcamento: number): LoteAuditoria[] {
  const lotes: LoteAuditoria[] = []
  let atual: LoteAuditoria | null = null
  for (const a of arquivos) {
    if (!atual || atual.chars + a.chars > orcamento) {
      atual = { indice: lotes.length + 1, arquivos: [], chars: 0 }
      lotes.push(atual)
    }
    atual.arquivos.push(a)
    atual.chars += a.chars
  }
  return lotes
}

function unicos(paths: string[]): string[] {
  return [...new Set(paths.filter(p => p.length > 0))]
}

export async function selecionarAuditoria(opts: OpcoesAuditoria = {}): Promise<PlanoAuditoria> {
  const raiz = opts.raiz ?? ROOT
  const orcamentoChars = orcamentoValido(opts.orcamentoChars ?? LOTE_CHARS_DEFAULT, LOTE_CHARS_DEFAULT)
  const maxLotes = tetoDeLotes(opts.maxLotes ?? 0)
  const listar = opts.listar ?? (() => listarRastreados(raiz))
  const ler = opts.ler ?? ((p: string) => lerTexto(raiz, p))
  const escopo = (opts.escopo ?? '').trim()
  const listados = unicos(await listar())
  // Le o repo INTEIRO para montar a cobertura, nao so o escopo pedido: um
  // recorte de escopo nao pode fazer o auditor esquecer que o teste existe.
  const cobertura = coberturaDeTeste(listados, ler)
  const paths = escopo ? listados.filter(p => p.startsWith(escopo)) : listados
  const fora: ForaDaAuditoria[] = []
  const auditaveis: ArquivoAuditavel[] = []
  for (const path of paths) {
    const rejeicao = rejeitarPorCaminho(path)
    if (rejeicao) { fora.push({ path, ...rejeicao }); continue }
    const texto = ler(path)
    if (texto === null) { fora.push({ path, motivo: 'ilegivel', detalhe: 'leitura falhou' }); continue }
    if (texto.includes('\0')) { fora.push({ path, motivo: 'ilegivel', detalhe: 'conteudo binario' }); continue }
    if (!texto.trim()) { fora.push({ path, motivo: 'arquivo-vazio', detalhe: '0 caractere util' }); continue }
    if (texto.length > orcamentoChars) {
      fora.push({ path, motivo: 'maior-que-o-lote', detalhe: `${texto.length} chars > orcamento de ${orcamentoChars} por lote` })
      continue
    }
    auditaveis.push(metricasDe(path, texto, cobertura))
  }
  const lotes = montarLotes(ordenarPorRisco(auditaveis), orcamentoChars)
  const cortados = maxLotes > 0 ? lotes.splice(maxLotes) : []
  for (const lote of cortados) {
    for (const a of lote.arquivos) {
      fora.push({ path: a.path, motivo: 'acima-do-limite-de-lotes', detalhe: `passou do limite de ${maxLotes} lote(s) por execucao` })
    }
  }
  const totalAuditado = lotes.reduce((n, l) => n + l.arquivos.length, 0)
  return { lotes, fora, totalListado: paths.length, totalAuditado, orcamentoChars, escopo }
}

export function coberturaFecha(plano: PlanoAuditoria): boolean {
  return plano.totalAuditado + plano.fora.length === plano.totalListado
}

export function foraPorMotivo(plano: PlanoAuditoria): GrupoFora[] {
  const mapa = new Map<MotivoFora, string[]>()
  for (const f of plano.fora) {
    const atual = mapa.get(f.motivo)
    if (atual) atual.push(f.path)
    else mapa.set(f.motivo, [f.path])
  }
  return [...mapa.entries()]
    .map(([motivo, paths]) => ({ motivo, label: LABEL_FORA[motivo], quantidade: paths.length, paths }))
    .sort((a, b) => (b.quantidade - a.quantidade) || a.motivo.localeCompare(b.motivo))
}

export function resumoAuditoria(plano: PlanoAuditoria): string {
  const linhas = [
    `auditoria manual: ${plano.totalAuditado} de ${plano.totalListado} arquivo(s) em ${plano.lotes.length} lote(s) — orcamento ${plano.orcamentoChars} chars/lote`,
  ]
  if (plano.escopo) {
    linhas.push(`escopo: ${plano.escopo} — recorte pedido; a cobertura declarada vale somente para ele, nao para o repo inteiro`)
    if (!plano.totalListado) {
      linhas.push(`ATENCAO: o recorte ${plano.escopo} nao casou com nenhum arquivo listado — confira o prefixo; nada foi auditado`)
    }
  }
  for (const g of foraPorMotivo(plano)) {
    const amostra = g.paths.slice(0, 5).join(', ')
    const resto = g.paths.length > 5 ? `, +${g.paths.length - 5}` : ''
    linhas.push(`fora (${g.quantidade}): ${g.label} — ${amostra}${resto}`)
  }
  if (!plano.fora.length) linhas.push('fora (0): nenhum arquivo ficou fora')
  if (!coberturaFecha(plano)) {
    linhas.push(`ATENCAO: contagem nao fecha (${plano.totalAuditado} + ${plano.fora.length} != ${plano.totalListado}) — nao declare cobertura`)
  }
  return linhas.join('\n')
}

export function renderLote(lote: LoteAuditoria, totalLotes: number): string {
  const cabecalho = `LOTE ${lote.indice}/${totalLotes} — ${lote.arquivos.length} arquivo(s), ${lote.chars} chars`
  const itens = lote.arquivos.map(a => {
    const risco = a.motivos.length ? ` — ${a.motivos.join('; ')}` : ''
    return `- ${a.path} (${a.linhas} linhas, ${a.funcoes} funcoes, ${a.exports} exports, risco ${a.risco})${risco}`
  })
  return [cabecalho, ...itens].join('\n')
}

export function ordenarAchados(achados: AchadoAuditoria[]): AchadoAuditoria[] {
  return [...achados].sort((a, b) =>
    (RANK_GRAVIDADE[a.gravidade] - RANK_GRAVIDADE[b.gravidade]) ||
    a.path.localeCompare(b.path) ||
    ((a.linha ?? 0) - (b.linha ?? 0)))
}

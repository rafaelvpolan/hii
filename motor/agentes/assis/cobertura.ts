// ASS — quem tem teste e quem nao tem.
//
// Por que import e nao nome: o casamento por stem quebra no instante em que o
// fonte e renomeado sem renomear o teste — foi o que a Onda 1 fez com 172
// arquivos, e o auditor passou a reportar "sem teste" para arquivo que TEM
// teste. Import e a relacao real; nome e uma convencao que envelhece.

export function extensaoDe(path: string): string {
  const base = path.split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

export function stemDe(path: string): string {
  const base = (path.split('/').pop() ?? '').toLowerCase()
  return base.replace(/\.(test|spec)\./, '.').replace(/\.[^.]+$/, '')
}

export function ehArquivoDeTeste(path: string): boolean {
  const p = path.toLowerCase()
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(test|tests|__tests__)\//.test(p) || /_test\.py$/.test(p)
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

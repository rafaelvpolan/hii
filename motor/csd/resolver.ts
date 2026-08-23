import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { diretorioDeSkills, lerSkill } from './acervo'
import type { Skill } from './acervo'
import { ROOT } from '../cdl/ali/config'

// CSD — a fusao. `_resolved/` e GERADA a partir de `_native/` e `_sources/*`.
// Ninguem edita `_resolved/` na mao: e recalculada quando skill-sources.json
// muda. Isso evita o problema que o proprio ECC documentou — duas instalacoes
// brigando pelo mesmo diretorio de skill. Aqui a fusao e deterministica e
// versionada, nao duas arvores disputando.

export interface FonteDeSkills {
  readonly id: string
  readonly ativa: boolean
}

export interface RegistroDeFontes {
  readonly versao: number
  // Quem vem primeiro vence em empate de id. `_native` sempre primeiro.
  readonly ordem: readonly string[]
  readonly fontes: readonly FonteDeSkills[]
}

interface Cru {
  versao?: number
  resolutionOrder?: string[]
  sources?: FonteDeSkills[]
}

export function arquivoDeFontes(): string {
  return join(ROOT, 'config', 'skill-sources.json')
}

export function lerFontes(): RegistroDeFontes {
  const caminho = arquivoDeFontes()
  if (!existsSync(caminho)) return { versao: 0, ordem: ['_native'], fontes: [] }
  let cru: Cru
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as Cru
  } catch (e) {
    throw new Error(`skill-sources.json ilegivel (${String((e as Error).message)})`)
  }
  const ordem = cru.resolutionOrder ?? ['_native']
  return { versao: cru.versao ?? 0, ordem, fontes: cru.sources ?? [] }
}

export interface ColisaoDeSkill {
  readonly id: string
  readonly origens: readonly string[]
}

export interface Resolucao {
  readonly skills: readonly Skill[]
  readonly colisoes: readonly ColisaoDeSkill[]
  readonly porOrigem: Readonly<Record<string, number>>
}

function raizDaOrigem(base: string, origem: string): string {
  return origem === '_native' ? join(base, '_native') : join(base, origem)
}

function varrerOrigem(base: string, origem: string): Skill[] {
  const raiz = raizDaOrigem(base, origem)
  if (!existsSync(raiz)) return []
  const fora: Skill[] = []
  for (const pack of readdirSync(raiz)) {
    const dirPack = join(raiz, pack)
    if (!statSync(dirPack).isDirectory()) continue
    for (const nome of readdirSync(dirPack)) {
      const arquivo = join(dirPack, nome, 'SKILL.md')
      if (!existsSync(arquivo)) continue
      fora.push(lerSkill(readFileSync(arquivo, 'utf8'), arquivo, pack, origem))
    }
  }
  return fora
}

export function resolver(base: string = diretorioDeSkills(), registro: RegistroDeFontes = lerFontes()): Resolucao {
  // Checado AQUI, e nao so na leitura do arquivo: invariante que vale num
  // caminho e nao no outro nao e invariante. Quem monta o registro na mao
  // (teste, futura CLI) passa pela mesma regra.
  if (registro.ordem[0] !== '_native') {
    throw new Error('_native tem de ser o primeiro em resolutionOrder — skill sua sempre vence adaptacao externa')
  }
  const escolhida = new Map<string, Skill>()
  const vistas = new Map<string, string[]>()
  const porOrigem: Record<string, number> = {}

  for (const origem of registro.ordem) {
    for (const s of varrerOrigem(base, origem)) {
      vistas.set(s.id, [...(vistas.get(s.id) ?? []), origem])
      if (!escolhida.has(s.id)) {
        escolhida.set(s.id, s)
        porOrigem[origem] = (porOrigem[origem] ?? 0) + 1
      }
    }
  }

  // Empate SEM `_native` envolvido e erro de build, nao resolucao silenciosa:
  // duas adaptacoes externas reivindicando o mesmo id significa que alguem
  // importou o mesmo conteudo duas vezes, e escolher no escuro esconde isso.
  const colisoes = [...vistas.entries()]
    .filter(([, origens]) => origens.length > 1 && !origens.includes('_native'))
    .map(([id, origens]) => ({ id, origens }))

  return { skills: [...escolhida.values()].sort((a, b) => a.id.localeCompare(b.id)), colisoes, porOrigem }
}

export function gerarResolved(base: string = diretorioDeSkills()): Resolucao {
  const r = resolver(base)
  if (r.colisoes.length) {
    const detalhe = r.colisoes.map(c => `${c.id} (${c.origens.join(' e ')})`).join('; ')
    throw new Error(`colisao de id entre origens externas, sem _native para desempatar: ${detalhe} — resolva no skill-sources.json em vez de deixar o build escolher no escuro`)
  }
  const destino = join(base, '_resolved')
  rmSync(destino, { recursive: true, force: true })
  for (const s of r.skills) {
    const alvo = join(destino, s.pack, s.id, 'SKILL.md')
    mkdirSync(dirname(alvo), { recursive: true })
    cpSync(s.arquivo, alvo)
  }
  writeFileSync(join(destino, '.gerado'), [
    '# GERADO por motor/csd/resolver.ts — nao edite nada aqui.',
    '# A fonte e skills/_native e skills/_sources, resolvida por config/skill-sources.json.',
    `# skills: ${r.skills.length} · origens: ${JSON.stringify(r.porOrigem)}`,
    '',
  ].join('\n'))
  return r
}

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { diretorioDeSkills, fundirOrigens } from './acervo.ts'
import type { Fusao } from './acervo.ts'
import { ROOT } from '../cdl/ali/config.ts'

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

export function resolver(base: string = diretorioDeSkills(), registro: RegistroDeFontes = lerFontes()): Fusao {
  return fundirOrigens(base, registro.ordem)
}

export function gerarResolved(base: string = diretorioDeSkills()): Fusao {
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

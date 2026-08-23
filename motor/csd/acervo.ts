import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../cdl/ali/config'
import { ENV_SKILLS_DIR } from '../cdl/ali/contrato'
import { casaPadrao } from './lei/guarda'

// CSD — Cascudo. O acervo: conteudo reutilizavel carregado sob demanda.
//
// Skill e CONTEUDO; papel e quem age. Uma skill nunca age sozinha — ela e
// injetada no prompt do papel quando o gatilho bate.
//
// O gatilho e DADO, nao codigo, e e resolvido em disco: arquivo tocado,
// extensao, dependencia declarada. Nunca "pergunta pra IA se esta skill se
// aplica" — isso trocaria uma decisao barata e reproduzivel por uma chamada de
// modelo que muda de opiniao entre execucoes.

export const PAPEIS_DE_SKILL = [
  'planejador', 'implementador', 'reparador', 'seguranca',
  'avaliador', 'documentador', 'empacotador', 'aprendiz',
] as const

export type PapelDeSkill = (typeof PAPEIS_DE_SKILL)[number]

export interface GatilhoDeSkill {
  // Sempre carrega, independente do diff. O pack `common` usa isto.
  readonly sempre?: boolean
  // Glob de caminho, no mesmo dialeto da LEI (`*` no segmento, `**` atravessa).
  readonly arquivos?: readonly string[]
  // Dependencia declarada no alvo (package.json, composer.json, *.csproj...).
  readonly deps?: readonly string[]
}

export interface Skill {
  readonly id: string
  readonly pack: string
  readonly origem: string
  readonly papeis: readonly PapelDeSkill[]
  readonly gatilho: GatilhoDeSkill
  readonly instrucoes: string
  readonly arquivo: string
}

export function diretorioDeSkills(): string {
  return process.env[ENV_SKILLS_DIR] || join(ROOT, 'skills')
}

interface Frontmatter {
  readonly campos: Record<string, string>
  readonly corpo: string
}

function lerFrontmatter(texto: string, arquivo: string): Frontmatter {
  if (!texto.startsWith('---\n')) throw new Error(`${arquivo}: SKILL.md sem frontmatter — a primeira linha tem de ser ---`)
  const fim = texto.indexOf('\n---', 4)
  if (fim < 0) throw new Error(`${arquivo}: frontmatter aberto e nunca fechado`)
  const campos: Record<string, string> = {}
  for (const linha of texto.slice(4, fim).split('\n')) {
    const t = linha.trim()
    if (!t || t.startsWith('#')) continue
    const sep = t.indexOf(':')
    if (sep < 0) throw new Error(`${arquivo}: linha de frontmatter sem "chave: valor" — ${t.slice(0, 60)}`)
    campos[t.slice(0, sep).trim()] = t.slice(sep + 1).trim()
  }
  return { campos, corpo: texto.slice(fim + 4).trim() }
}

function lista(valor: string | undefined): string[] {
  if (!valor) return []
  return valor.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

function ehPapel(v: string): v is PapelDeSkill {
  return (PAPEIS_DE_SKILL as readonly string[]).includes(v)
}

export function lerSkill(texto: string, arquivo: string, pack: string, origem: string): Skill {
  const { campos, corpo } = lerFrontmatter(texto, arquivo)
  const id = campos.id ?? ''
  if (!id) throw new Error(`${arquivo}: skill sem id`)
  if (!corpo) throw new Error(`${arquivo}: skill "${id}" sem corpo de instrucao — frontmatter sozinho nao ensina nada`)

  const papeis = lista(campos.papeis)
  const fora = papeis.filter(p => !ehPapel(p))
  if (fora.length) throw new Error(`${arquivo}: papel desconhecido em "${id}": ${fora.join(', ')}`)
  if (!papeis.length) throw new Error(`${arquivo}: skill "${id}" sem papel — conteudo que ninguem carrega e conteudo morto`)

  const gatilho: GatilhoDeSkill = {
    sempre: campos.sempre === 'true',
    arquivos: lista(campos.arquivos),
    deps: lista(campos.deps),
  }
  if (!gatilho.sempre && !gatilho.arquivos?.length && !gatilho.deps?.length) {
    throw new Error(`${arquivo}: skill "${id}" sem gatilho — declare "sempre: true", "arquivos:" ou "deps:". Skill que nunca carrega e peso morto`)
  }
  return { id, pack, origem, papeis: papeis as PapelDeSkill[], gatilho, instrucoes: corpo, arquivo }
}

function varrerPack(raiz: string, pack: string, origem: string): Skill[] {
  const dir = join(raiz, pack)
  if (!existsSync(dir)) return []
  const fora: Skill[] = []
  for (const nome of readdirSync(dir)) {
    const skillDir = join(dir, nome)
    if (!statSync(skillDir).isDirectory()) continue
    const arquivo = join(skillDir, 'SKILL.md')
    if (!existsSync(arquivo)) continue
    fora.push(lerSkill(readFileSync(arquivo, 'utf8'), arquivo, pack, origem))
  }
  return fora
}

export function carregarAcervo(raiz: string = join(diretorioDeSkills(), '_resolved')): Skill[] {
  if (!existsSync(raiz)) return []
  const packs = readdirSync(raiz).filter(n => statSync(join(raiz, n)).isDirectory())
  return packs.flatMap(p => varrerPack(raiz, p, '_resolved')).sort((a, b) => a.id.localeCompare(b.id))
}

export interface ContextoDeGatilho {
  readonly arquivos: readonly string[]
  readonly deps: readonly string[]
}

// Puro e deterministico: mesma entrada, mesma saida, zero I/O e zero IA.
export function gatilhoBate(g: GatilhoDeSkill, ctx: ContextoDeGatilho): boolean {
  if (g.sempre) return true
  if ((g.arquivos ?? []).some(p => ctx.arquivos.some(a => casaPadrao(p, a)))) return true
  return (g.deps ?? []).some(d => ctx.deps.includes(d))
}

export function skillsPara(papel: PapelDeSkill, ctx: ContextoDeGatilho, acervo: readonly Skill[] = carregarAcervo()): Skill[] {
  return acervo.filter(s => s.papeis.includes(papel) && gatilhoBate(s.gatilho, ctx))
}

export function renderizarSkills(skills: readonly Skill[]): string {
  if (!skills.length) return ''
  const blocos = skills.map(s => `### skill: ${s.id} (${s.pack})\n${s.instrucoes}`)
  return [
    `CONHECIMENTO CARREGADO (${skills.length} skill(s), gatilho determinístico por arquivo/dependência):`,
    ...blocos,
  ].join('\n\n')
}

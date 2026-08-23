import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../cdl/ali/config'
import { ENV_REGRAS_FILE } from '../../cdl/ali/contrato'

// LEI — o que o gate cobra sempre, sem interpretacao de modelo.
//
// Existe por um motivo estreito: `risk: high` e escrito NO CARD, e quem escreve
// o card muitas vezes e a propria IA. Isso e um vetor de bypass — subdeclarar
// risco pula gate de seguranca e de teste. A guarda olha o DIFF, que a IA nao
// consegue subdeclarar sem tambem deixar de fazer o trabalho.
//
// A regra de ouro, testada como invariante: o card pode SUBIR o rigor, nunca
// baixar. Tudo aqui so acrescenta exigencia.

export interface GatilhoDeRegra {
  readonly arquivos?: readonly string[]
}

export interface RegraInegociavel {
  readonly id: string
  readonly categoria: string
  readonly descricao: string
  readonly gatilho: GatilhoDeRegra
  readonly exigencia: string
}

interface RegrasCruas {
  versao?: number
  regras?: RegraInegociavel[]
}

export function arquivoDeRegras(): string {
  return process.env[ENV_REGRAS_FILE] || join(ROOT, 'config', 'regras-inegociaveis.json')
}

export function lerRegras(): RegraInegociavel[] {
  const caminho = arquivoDeRegras()
  if (!existsSync(caminho)) return []
  let cru: RegrasCruas
  // Regra ilegivel NAO pode virar "nenhuma regra": isso transformaria um erro
  // de digitacao em bypass silencioso de todas as exigencias de uma vez.
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as RegrasCruas
  } catch (e) {
    throw new Error(`regras-inegociaveis.json ilegivel (${String((e as Error).message)}) — recuse trabalhar sem elas em vez de tratar como lista vazia`)
  }
  const regras = cru.regras ?? []
  for (const r of regras) {
    if (!r.id || !r.exigencia) throw new Error(`regra sem id ou exigencia em ${caminho}: ${JSON.stringify(r).slice(0, 120)}`)
  }
  return regras
}

// Glob simples, deliberadamente: `*` casa dentro de um segmento, `**` atravessa
// segmentos. Sem dependencia externa, e o suficiente para caminho de arquivo.
export function casaPadrao(padrao: string, caminho: string): boolean {
  const rx = padrao
    .split('/')
    .map(parte => parte === '**'
      ? '.*'
      : parte.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('/')
    .replace(/\.\*\//g, '(?:.*/)?')
  return new RegExp(`^${rx}$`).test(caminho)
}

export function regrasQueBatem(arquivos: readonly string[], regras: readonly RegraInegociavel[]): RegraInegociavel[] {
  return regras.filter(r => (r.gatilho.arquivos ?? []).some(p => arquivos.some(a => casaPadrao(p, a))))
}

// Areas onde errar sai caro demais para confiar no que o card declarou. Isto
// nao vem do arquivo de regras: e o piso que existe mesmo com o arquivo vazio.
const FORCA_COMPLETO: readonly RegExp[] = [
  /(^|\/)migrations?\//i,
  /(^|\/)(auth|autenticacao)\//i,
  /payment|pagamento|checkout|cobranca|billing/i,
  /(^|\/)\.env($|\.)/,
  /(^|\/)(secrets?|credenciais?)\//i,
  /\.(pem|key|p12|pfx)$/i,
]

export interface VeredictoDaLei {
  // 'completo' = sobe o rigor. null = a guarda nao tem opiniao (nunca baixa).
  readonly forca: 'completo' | null
  readonly motivos: readonly string[]
  readonly regras: readonly RegraInegociavel[]
}

export function avaliarDiff(arquivos: readonly string[], regras: readonly RegraInegociavel[] = lerRegras()): VeredictoDaLei {
  const motivos: string[] = []
  for (const a of arquivos) {
    const rx = FORCA_COMPLETO.find(r => r.test(a))
    if (rx) motivos.push(`${a} casa area de rigor obrigatorio (${rx.source})`)
  }
  const batem = regrasQueBatem(arquivos, regras)
  for (const r of batem) motivos.push(`regra ${r.id}: ${r.descricao} — exige ${r.exigencia}`)
  return { forca: motivos.length ? 'completo' : null, motivos, regras: batem }
}

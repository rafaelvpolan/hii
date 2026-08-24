import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../cdl/ali/config.ts'

// VTB — Vital Brazil: soro especifico contra veneno especifico. Um checklist
// generico de seguranca nao pega mass assignment de Eloquent nem SSRF de fetch;
// cada stack tem o seu, versionado em disco, rodando DEPOIS do baseline.

export interface ItemDeChecklist {
  readonly id: string
  readonly checa: string
}

export interface ChecklistDeStack {
  readonly stack: string
  readonly itens: readonly ItemDeChecklist[]
}

export function diretorioDeChecklists(): string {
  return join(ROOT, 'config', 'security-checklist')
}

export function stacksComChecklist(): string[] {
  const dir = diretorioDeChecklists()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort()
}

export function lerChecklist(stack: string): ChecklistDeStack | null {
  const caminho = join(diretorioDeChecklists(), `${stack}.json`)
  if (!existsSync(caminho)) return null
  let cru: ChecklistDeStack
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as ChecklistDeStack
  } catch (e) {
    throw new Error(`security-checklist/${stack}.json ilegivel (${String((e as Error).message)})`)
  }
  if (!cru.itens?.length) throw new Error(`security-checklist/${stack}.json sem item — lista vazia daria um checklist que aprova tudo`)
  for (const i of cru.itens) {
    if (!i.id || !i.checa) throw new Error(`security-checklist/${stack}.json: item sem id ou sem "checa"`)
  }
  return cru
}

// Deterministico: casa o texto de stack do contrato do alvo com o nome do
// arquivo. Sem match, devolve null e o baseline generico segue sozinho.
export function checklistParaStack(textoDaStack: string): ChecklistDeStack | null {
  const t = (textoDaStack ?? '').toLowerCase()
  const achado = stacksComChecklist().find(s => t.includes(s))
  return achado ? lerChecklist(achado) : null
}

export function renderizarChecklist(c: ChecklistDeStack | null): string {
  if (!c) return ''
  return [
    `CHECKLIST DE SEGURANCA — ${c.stack} (config/security-checklist/${c.stack}.json), depois do baseline generico:`,
    ...c.itens.map(i => `- [${i.id}] ${i.checa}`),
  ].join('\n')
}

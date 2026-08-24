import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeContract } from './sondar.ts'
import type { Contract } from './tipos.ts'
import { avisarArquivoIlegivel, motivoDoErro } from '../ali/aviso.ts'

export function contractFile(repo: string): string {
  return join(repo, '.hii', 'contract.json')
}

export function readContract(repo: string): Contract | null {
  const f = contractFile(repo)
  if (!existsSync(f)) return null
  let parsed: Contract | null = null
  try {
    parsed = JSON.parse(readFileSync(f, 'utf8')) as Contract | null
  } catch (e) {
    // Contrato corrompido virava "sem contrato": quem chama trata como alvo ainda
    // nao sondado e segue sem stack, sem comandos e sem gate de URL. O contrato
    // existe em disco, escrito, e o motor o ignorava calado.
    avisarArquivoIlegivel(f, motivoDoErro(e as Error), 'o alvo sera tratado como se NAO tivesse contrato: sem stack, sem comandos e sem os gates que dependem deles. `ensureContract` vai SOBRESCREVER o arquivo com uma sondagem nova — se havia edicao manual nele, ela se perde aqui')
    return null
  }
  const c = parsed
  if (!c || typeof c !== 'object') {
    avisarArquivoIlegivel(f, 'o conteudo nao e um objeto de contrato', 'o alvo sera tratado como se NAO tivesse contrato')
    return null
  }
  if (c.version !== 1) {
    avisarArquivoIlegivel(f, `version=${JSON.stringify(c.version)}, esperado 1`, 'contrato de versao desconhecida e ignorado — o alvo sera sondado como novo')
    return null
  }
  return c
}

export function writeContract(repo: string, contract: Contract): string {
  const dir = join(repo, '.hii')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const f = contractFile(repo)
  writeFileSync(f, JSON.stringify(contract, null, 2) + '\n')
  return f
}

export interface SyncResult {
  contract: Contract
  changed: boolean
  file: string
}

export function syncContract(repo: string, now: string): SyncResult {
  const fresh = probeContract(repo, now)
  const current = readContract(repo)
  if (current && current.hash === fresh.hash) return { contract: current, changed: false, file: contractFile(repo) }
  return { contract: fresh, changed: true, file: writeContract(repo, fresh) }
}

// Contrato ausente OU ilegivel cai na sondagem, que reescreve o arquivo. E a
// recuperacao certa (o contrato e derivado do disco, nao autoral), mas nao e
// silenciosa: readContract ja avisou o que estava ilegivel antes de chegar aqui.
export function ensureContract(repo: string, now: string): Contract {
  return readContract(repo) ?? syncContract(repo, now).contract
}

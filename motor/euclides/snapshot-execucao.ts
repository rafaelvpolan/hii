import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, politicaDeExecucaoEfetiva } from '../cordel/alicerce/config.ts'
import type { PoliticaDeExecucaoEfetiva } from '../cordel/alicerce/config.ts'
import { readCard, updateCardPorAcaoHumana } from '../cordel/store.ts'
import { preferencias } from '../tomada/preferencias.ts'
import type { PreferenciasDeIa } from '../tomada/preferencias.ts'
import { writeFileAtomic, withFileLock } from '../oswaldo/mutirao/trava-arquivo.ts'
import { jsonPublico } from '../observabilidade/registro.ts'
import type { Json } from '../api/contrato.ts'

export interface SnapshotExecucao {
  versao: 1
  hash: string
  tarefa: string
  repo: string
  instante: string
  motivo: string
  configuracao: PreferenciasDeIa
  politicaExecucao?: PoliticaDeExecucaoEfetiva
  campos: Record<string, string>
}
const CAMPOS = ['repo', 'sessao_id', 'motor_modo', 'pipeline', 'plano_revisao', 'plano_hash', 'microtask_atual', 'retomar_em', 'ai', 'effort', 'risk', 'cost_usd', 'cost_floor', 'cost_unverified', 'tokens_total', 'provider_override_implement', 'orq_modelo'] as const
function diretorio(id: string): string {
  if (!/^\d{3,12}$/.test(id)) throw new Error('ID invalido')
  return join(cardsDir(), 'recuperacao', 'snapshots', id)
}
function conferir(s: SnapshotExecucao): SnapshotExecucao {
  const { hash, ...dados } = s
  if (s.versao !== 1 || hash !== createHash('sha256').update(JSON.stringify(dados)).digest('hex')) throw new Error('Snapshot invalido ou adulterado')
  return s
}
export function snapshotsDaExecucao(id: string): SnapshotExecucao[] {
  const dir = diretorio(id)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(n => /^[a-f0-9]{64}\.json$/.test(n))
    .map(n => conferir(JSON.parse(readFileSync(join(dir, n), 'utf8')) as SnapshotExecucao))
    .sort((a, b) => a.instante.localeCompare(b.instante))
}
export function snapshotDaExecucao(id: string, hash: string): SnapshotExecucao {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash de snapshot invalido')
  const s = conferir(JSON.parse(readFileSync(join(diretorio(id), hash + '.json'), 'utf8')) as SnapshotExecucao)
  if (s.tarefa !== id || s.repo !== readCard(id)?.fm.repo) throw new Error('Snapshot pertence a outra tarefa/projeto')
  return s
}
export function registrarSnapshot(id: string, motivo: string, config: PreferenciasDeIa = preferencias()): SnapshotExecucao {
  const card = readCard(id)
  if (!card) throw new Error('Tarefa ausente')
  const campos = Object.fromEntries(CAMPOS.filter(k => card.fm[k] !== undefined).map(k => [k, card.fm[k]!]))
  const seguro = jsonPublico(JSON.parse(JSON.stringify(config)) as Json) as PreferenciasDeIa
  const dados = { versao: 1 as const, tarefa: id, repo: card.fm.repo || '', instante: new Date().toISOString(), motivo, configuracao: seguro,
    politicaExecucao: politicaDeExecucaoEfetiva(), campos }
  const hash = createHash('sha256').update(JSON.stringify(dados)).digest('hex')
  const snapshot = { ...dados, hash }
  const dir = diretorio(id)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, hash + '.json')
  withFileLock(file, () => {
    if (!existsSync(file)) { writeFileAtomic(file, JSON.stringify(snapshot)); chmodSync(file, 0o600) }
  })
  return snapshot
}
export function configuracaoDaTarefa(id: string): PreferenciasDeIa {
  const card = readCard(id)
  return card?.fm.recuperacao_config ? snapshotDaExecucao(id, card.fm.recuperacao_config).configuracao : preferencias()
}
export function politicaDaTarefa(id: string): PoliticaDeExecucaoEfetiva {
  const card = readCard(id)
  return card?.fm.recuperacao_config ? snapshotDaExecucao(id, card.fm.recuperacao_config).politicaExecucao ?? politicaDeExecucaoEfetiva() : politicaDeExecucaoEfetiva()
}
export function restaurarConfiguracao(id: string, hash: string): SnapshotExecucao {
  const snapshot = snapshotDaExecucao(id, hash)
  const card = readCard(id)
  if (!card || !['PAUSED', 'HALTED', 'INBOX', 'READY'].includes(card.fm.status || '')) throw new Error('Pare a tarefa antes de restaurar configuracao')
  registrarSnapshot(id, 'antes de restaurar configuracao', configuracaoDaTarefa(id))
  updateCardPorAcaoHumana(id, {
    fields: atual => {
      if (!['PAUSED', 'HALTED', 'INBOX', 'READY'].includes(atual.status || '')) throw new Error('Estado mudou durante restauracao')
      const restaurados = Object.fromEntries(['ai', 'effort', 'provider_override_implement', 'orq_modelo', 'pipeline'].map(k => [k, snapshot.campos[k] || '']))
      return { ...restaurados, recuperacao_config: hash }
    },
    log: new Date().toISOString() + ' configuracao restaurada do snapshot ' + hash + '; tarefa permanece parada',
  })
  return snapshot
}

import { gastoDoCard } from '../euclides/tesouro/orcamento.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { splitFrontMatter } from '../cordel/frontmatter.ts'
import { validarPlano } from '../oswaldo/orquestracao/contrato.ts'
import type { PlanoDeExecucao } from '../oswaldo/orquestracao/contrato.ts'
import { chaveDoProjeto } from '../oswaldo/orquestracao/config.ts'
import { salvarPlano } from '../oswaldo/orquestracao/planos.ts'
import type { RevisaoDePlano } from '../oswaldo/orquestracao/planos.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import type { PacoteRecuperacao } from './recuperacao.ts'

interface TentativaLegada {
  microtask: string; inicio: string; fim: string; provedor: string; modelo: string
  estado: 'executando' | 'concluida' | 'falhou' | 'interrompida'; custo: string; motivo: string
}
interface CheckpointLegado { versao: 1; hash: string; feitas: string[]; fingerprint: string; tentativas?: TentativaLegada[] }
export interface MigracaoDePlano {
  revisoes: RevisaoDePlano[]; checkpoint: CheckpointLegado; origemId: string; revisaoAtiva: number
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
function anexo(p: PacoteRecuperacao, nome: string): string {
  const a = p.anexos.find(a => a.nome === nome)
  if (!a) throw new Error('Artefato legado ausente: ' + nome)
  const bytes = Buffer.from(a.conteudo, 'base64')
  if (sha(bytes.toString()) !== a.sha256) throw new Error('Hash do artefato legado divergente: ' + nome)
  return bytes.toString()
}
export function diagnosticarPlanoLegado(p: PacoteRecuperacao, fingerprint: string): MigracaoDePlano | null {
  const fm = splitFrontMatter(p.documento).fm
  if (!fm.plano_revisao && !fm.plano_hash) return null
  const ativa = Number(fm.plano_revisao)
  if (!Number.isSafeInteger(ativa) || ativa < 1 || !/^[a-f0-9]{64}$/.test(fm.plano_hash || '')) throw new Error('Referencia do plano legado incompleta.')
  const h = JSON.parse(anexo(p, 'planos/' + chaveDoProjeto(p.repo) + '-' + fm.id + '.json')) as { versao: number; revisoes: RevisaoDePlano[] }
  if (h.versao !== 1 || !Array.isArray(h.revisoes) || !h.revisoes.length || h.revisoes.length > 100) throw new Error('Historico de planos legado invalido.')
  for (const [indice, r] of h.revisoes.entries()) {
    validarPlano(r.plano)
    if (r.revisao !== indice + 1 || r.plano.repo !== p.repo || r.plano.id !== fm.id ||
      r.plano.sessaoId !== (fm.sessao_id || fm.id) || r.hash !== sha(JSON.stringify(r.plano))) throw new Error('Identidade ou hash do plano legado divergente.')
    if (r.plano.dependenciasProduto?.length) throw new Error('Dependencias de produto legadas exigem reconciliacao dos IDs e certificados.')
  }
  const revisao = h.revisoes.find(r => r.revisao === ativa)
  if (!revisao || revisao.hash !== fm.plano_hash) throw new Error('Revisao ativa do plano nao corresponde ao card.')
  const c = JSON.parse(anexo(p, 'orquestracao/execucao-' + fm.id + '-' + ativa + '.json')) as CheckpointLegado
  if (!c || c.versao !== 1 || c.hash !== revisao.hash || !Array.isArray(c.feitas) ||
    new Set(c.feitas).size !== c.feitas.length || !fingerprint || c.fingerprint !== fingerprint ||
    !Array.isArray(c.tentativas)) throw new Error('Checkpoint ausente, invalido ou diferente do trabalho atual.')
  const tarefas = new Map(revisao.plano.microtasks.map(m => [m.id, m]))
  for (const t of c.tentativas) {
    if (!t || !tarefas.has(t.microtask) || !['concluida', 'falhou'].includes(t.estado) ||
      typeof t.custo !== 'string' || (t.custo !== '' && (!Number.isFinite(Number(t.custo)) || Number(t.custo) < 0)) ||
      !Number.isFinite(Date.parse(t.inicio)) || !Number.isFinite(Date.parse(t.fim)) ||
      typeof t.provedor !== 'string' || typeof t.modelo !== 'string' || typeof t.motivo !== 'string') {
      throw new Error('Tentativa legada incerta ou malformada; reconcilie os efeitos antes de retomar.')
    }
  }
  const gasto = gastoDoCard(fm.cost_usd)
  const conhecido = c.tentativas.reduce((total, t) => total + (Number(t.custo) || 0), 0)
  if (gasto === null || gasto + 0.000001 < conhecido ||
    (c.tentativas.some(t => !t.custo.trim()) && !fm.cost_unverified && !fm.cost_floor)) throw new Error('Custo do checkpoint diverge do card ou tem lacuna nao registrada.')
  for (const m of revisao.plano.microtasks) {
    if (c.tentativas.filter(t => t.microtask === m.id).at(-1)?.estado === 'concluida' && !c.feitas.includes(m.id)) throw new Error('Tentativa concluida ausente do checkpoint; reconciliacao necessaria.')
  }
  for (const feita of c.feitas) {
    const m = tarefas.get(feita)
    const ultima = c.tentativas.filter(t => t.microtask === feita).at(-1)
    if (!m || !m.dependeDe.every(d => c.feitas.includes(d)) || ultima?.estado !== 'concluida') throw new Error('Checkpoint declara conclusao sem tentativa/dependencias correspondentes.')
  }
  return { revisoes: h.revisoes, checkpoint: c, origemId: fm.id!, revisaoAtiva: ativa }
}
export function aplicarPlanoLegado(id: string, origem: string, m: MigracaoDePlano): { plano_revisao: string; plano_hash: string; sessao_id: string } {
  if (!/^\d{3,12}$/.test(id) || !/^[a-f0-9]{64}$/.test(origem)) throw new Error('Destino de migracao invalido.')
  let ativa: RevisaoDePlano | undefined
  // Cada revisao tem chave deterministica. Uma falha parcial mantem o card pausado;
  // repetir o preparo reconcilia as revisoes ja gravadas, sem novo despacho.
  for (const r of m.revisoes) {
    const plano: PlanoDeExecucao = { ...r.plano, id, sessaoId: id }
    const nova = salvarPlano(plano, r.revisao - 1, 'recuperacao-' + origem + '-' + r.revisao)
    if (r.revisao === m.revisaoAtiva) ativa = nova
  }
  if (!ativa) throw new Error('Revisao ativa nao migrada.')
  const dir = join(cardsDir(), 'orquestracao')
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, 'execucao-' + id + '-' + ativa.revisao + '.json')
  const checkpoint = { ...m.checkpoint, hash: ativa.hash }
  withFileLock(arquivo, () => {
    if (existsSync(arquivo)) {
      if (JSON.stringify(JSON.parse(readFileSync(arquivo, 'utf8'))) !== JSON.stringify(checkpoint)) throw new Error('Checkpoint de destino mudou; nenhuma sobrescrita permitida.')
    } else writeFileAtomic(arquivo, JSON.stringify(checkpoint, null, 2) + '\n')
  })
  return { plano_revisao: String(ativa.revisao), plano_hash: ativa.hash, sessao_id: id }
}

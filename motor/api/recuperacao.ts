import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { allCards, createCard, repoRegistered } from '../cordel/store.ts'
import { splitFrontMatter } from '../cordel/frontmatter.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { registrarSnapshot, snapshotsDaExecucao } from '../euclides/snapshot-execucao.ts'
import { textoPublico } from '../observabilidade/registro.ts'
import { ErroApi, campos, objeto, texto } from './contrato.ts'
import type { Objeto } from './contrato.ts'

export interface PacoteRecuperacao {
  versao: 1
  origem: string
  arquivo: string
  repo: string
  documento: string
  anexos: { nome: string; conteudo: string; sha256: string }[]
}
export interface PreviaRecuperacao {
  versao: 1
  origem: string
  hash: string
  tarefa: string | null
  estado: 'importar' | 'vinculada' | 'bloqueada'
  motivo: string
  origemStatus: string
  preservados: string[]
}
export function hashRecuperacao(pacote: PacoteRecuperacao): string {
  return createHash('sha256').update(JSON.stringify(pacote)).digest('hex')
}
function contemSegredo(valor: string): boolean {
  const comparavel = valor.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
  return textoPublico(comparavel) !== comparavel
}
export function validarPacote(b: Objeto): PacoteRecuperacao {
  campos(b, ['versao', 'origem', 'arquivo', 'repo', 'documento', 'anexos'])
  if (b.versao !== 1) throw new ErroApi(400, 'versao_incompativel', 'recuperacao suporta versao 1')
  const origem = texto(b, 'origem', true, 128)
  const arquivo = texto(b, 'arquivo', true, 240)
  const repo = texto(b, 'repo', true, 256)
  if (typeof b.documento !== 'string' || !b.documento || Buffer.byteLength(b.documento) > 1048576) throw new ErroApi(400, 'documento_invalido', 'documento UTF-8 obrigatorio, limitado a 1 MiB')
  const documento = b.documento
  if (!/^[a-f0-9]{64}$/.test(origem) || !/^\d{3,12}-[^/\\]+\.md$/.test(arquivo)) throw new ErroApi(400, 'origem_invalida', 'identidade ou arquivo de origem invalido')
  if (!repoRegistered(repo)) throw new ErroApi(409, 'repo_ausente', 'registre o projeto no HII antes de recuperar')
  const card = splitFrontMatter(documento)
  if (card.fm.repo !== repo || !arquivo.startsWith(card.fm.id + '-') || !card.fm.title) throw new ErroApi(400, 'card_invalido', 'metadados divergem do pacote')
  if (contemSegredo(documento)) throw new ErroApi(400, 'segredo_no_pacote', 'remova credenciais do card antes de transferir; original foi preservado')
  if (!Array.isArray(b.anexos) || b.anexos.length > 64) throw new ErroApi(400, 'anexos_invalidos', 'envie inventario de ate 64 artefatos')
  const nomes = new Set<string>()
  let total = Buffer.byteLength(documento)
  const anexos = b.anexos.map(valor => {
    const a = objeto(valor)
    campos(a, ['nome', 'conteudo', 'sha256'])
    const nome = texto(a, 'nome', true, 240)
    if (typeof a.conteudo !== 'string') throw new ErroApi(400, 'anexo_invalido', 'conteudo base64 obrigatorio')
    const conteudo = a.conteudo
    const sha256 = texto(a, 'sha256', true, 64)
    if (nomes.has(nome) || !/^[a-zA-Z0-9_./-]+$/.test(nome) || nome.startsWith('/') || nome.split('/').some(p => !p || p === '..' || p === '.') || /(?:^|\/)(?:\.env|credentials)/i.test(nome)) throw new ErroApi(400, 'anexo_invalido', 'nome de artefato invalido ou duplicado')
    nomes.add(nome)
    const bytes = Buffer.from(conteudo, 'base64')
    if (bytes.toString('base64') !== conteudo || createHash('sha256').update(bytes).digest('hex') !== sha256) throw new ErroApi(400, 'anexo_corrompido', 'hash de artefato divergente')
    total += bytes.length
    if (total > 1048576) throw new ErroApi(413, 'pacote_grande', 'transferencia limitada a 1 MiB; nenhum artefato foi descartado')
    if (contemSegredo(bytes.toString('utf8'))) throw new ErroApi(400, 'segredo_no_pacote', 'artefato contem credencial; original preservado')
    return { nome, conteudo, sha256 }
  })
  return { versao: 1, origem, arquivo, repo, documento, anexos }
}
function vinculadas(p: PacoteRecuperacao): string[] {
  return allCards().filter(c => c.recuperacao_origem === p.origem && c.repo === p.repo).map(c => c.id || '')
}
export function previaRecuperacao(p: PacoteRecuperacao): PreviaRecuperacao {
  const card = splitFrontMatter(p.documento)
  const ids = vinculadas(p)
  const tarefa = ids[0] || null
  let motivo = 'Importar uma unica tarefa em PAUSED; preservar original e historico. Retomada exige acao explicita.'
  let estado: PreviaRecuperacao['estado'] = tarefa ? 'vinculada' : 'importar'
  if (ids.length > 1) { estado = 'bloqueada'; motivo = 'Mais de uma tarefa do motor para a mesma origem; reconcilie o vinculo.' }
  else if (tarefa) motivo = 'Origem ja vinculada; nenhuma nova tarefa sera criada.'
  else if (['COMPLETED', 'MERGED', 'DEPLOYED', 'PR_OPEN'].includes(card.fm.status || '')) { estado = 'bloqueada'; motivo = 'Tarefa encerrada nao deve ser reexecutada; importe apenas como arquivo de historico fora deste fluxo.' }
  return { versao: 1, origem: p.origem, hash: hashRecuperacao(p), tarefa, estado, motivo, origemStatus: card.fm.status || '', preservados: ['card original', 'objetivo', 'historico', 'custos', ...p.anexos.map(a => a.nome)] }
}
export function aplicarRecuperacao(p: PacoteRecuperacao, esperado: string): PreviaRecuperacao {
  if (esperado !== hashRecuperacao(p)) throw new ErroApi(412, 'previa_alterada', 'a origem mudou; gere outra previa')
  const dir = join(cardsDir(), 'recuperacao', 'importacoes')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, p.origem + '.json')
  return withFileLock(file, () => {
    const previa = previaRecuperacao(p)
    if (previa.estado === 'bloqueada') throw new ErroApi(409, 'recuperacao_bloqueada', previa.motivo)
    if (existsSync(file)) {
      const salvo = JSON.parse(readFileSync(file, 'utf8')) as { hash: string }
      if (salvo.hash !== previa.hash) throw new ErroApi(409, 'origem_alterada', 'origem ja preservada com outro conteudo; reconcilie antes de substituir')
    } else {
      writeFileAtomic(file, JSON.stringify({ hash: previa.hash, pacote: p }))
      chmodSync(file, 0o600)
    }
    if (previa.tarefa) {
      if (!snapshotsDaExecucao(previa.tarefa).length) registrarSnapshot(previa.tarefa, 'reconciliacao apos interrupcao; configuracao atual, original nao comprovada')
      return previa
    }
    const card = splitFrontMatter(p.documento)
    const manter = ['title', 'risk', 'created', 'cost_usd', 'cost_floor', 'cost_unverified', 'tokens_total', 'ai', 'effort'] as const
    const campos = Object.fromEntries(manter.filter(k => card.fm[k] !== undefined).map(k => [k, card.fm[k]!]))
    const id = createCard({ ...campos, repo: p.repo, status: 'PAUSED', recuperacao_origem: p.origem,
      recuperacao_hash: previa.hash, recuperacao_arquivo: p.arquivo, recuperacao_status: card.fm.status || '',
      recuperacao_pendente: 'true', motor_modo: card.fm.motor_modo || 'passivo' },
      card.body + '\n\n## Recuperacao\n' + new Date().toISOString() + ' origem preservada; importacao sem despacho automatico\n')
    registrarSnapshot(id, 'importacao: configuracao atual do motor; origem preservada separadamente')
    return { ...previa, tarefa: id, estado: 'vinculada', motivo: 'Importacao confirmada em PAUSED; revise checkpoint e configuracao antes de retomar.' }
  })
}

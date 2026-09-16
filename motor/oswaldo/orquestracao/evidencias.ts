import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { run, runGit } from '../../quilombo/git.ts'
import { writeFileAtomic } from '../mutirao/trava-arquivo.ts'
import { validarPlano } from './contrato.ts'
import type { PlanoDeExecucao } from './contrato.ts'
import { iniciar, atualizar, terminar, saida, recurso } from '../../observabilidade/registro.ts'
import { registrarArtefato } from '../../observabilidade/artefatos.ts'

export interface Evidencia {
  criterio: string
  estado: 'aprovado' | 'reprovado' | 'inconclusivo' | 'nao-aplicavel'
  obrigatorio: boolean
  comando: string[]
  exitCode: number | null
  sinal: string
  timeout: boolean
  duracaoMs: number
  saida: string
}

export interface RelatorioDeEvidencias {
  versao: 1
  plano: string
  revisao: number
  fingerprint: string
  instante: string
  evidencias: Evidencia[]
  aprovado: boolean
}

export function ocultarSegredos(texto: string): string {
  let limpo = texto
  for (const [nome, valor] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY/i.test(nome) && valor && valor.length >= 6) limpo = limpo.replaceAll(valor, '[REDACTED]')
  }
  return limpo.replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
}

export async function fingerprintDoTrabalho(wt: string): Promise<string> {
  const hash = createHash('sha256')
  for (const args of [['rev-parse', 'HEAD'], ['diff', '--binary', 'HEAD']]) {
    const r = await runGit(wt, args)
    if (r.err) throw new Error(`nao foi possivel vincular evidencia ao git: ${r.err.message}`)
    hash.update(r.stdout)
  }
  const novos = await runGit(wt, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (novos.err) throw new Error('nao foi possivel listar arquivos novos')
  for (const nome of novos.stdout.split('\0').filter(Boolean).sort()) {
    const caminho = dentroDoWorktree(wt, nome)
    hash.update(nome).update(readFileSync(caminho))
  }
  return hash.digest('hex')
}

function dentroDoWorktree(wt: string, caminho: string): string {
  const raiz = realpathSync(wt)
  const alvo = realpathSync(resolve(raiz, caminho))
  const rel = relative(raiz, alvo)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('caminho sai do worktree, inclusive por symlink')
  return alvo
}

export function arquivoDeEvidencias(id: string, revisao: number): string {
  return join(cardsDir(), 'evidencias', `${id}-${revisao}.json`)
}

export async function coletarEvidencias(plano: PlanoDeExecucao, revisao: number, wt: string, executar: typeof run = run): Promise<RelatorioDeEvidencias> {
  validarPlano(plano)
  const atividades: string[] = []
  try {
    const fingerprint = await fingerprintDoTrabalho(wt)
    const evidencias: Evidencia[] = []
    for (const c of plano.criterios) {
      const atividade = iniciar({ repo: plano.repo, sessao: plano.sessaoId, execucao: plano.id }, recurso(c.id, 'validation'), { criterio: c.id, obrigatorio: c.obrigatorio })
      atividades.push(atividade)
      atualizar(atividade, a => { a.planoRevisao = revisao })
      const e: Evidencia = { criterio: c.id, obrigatorio: c.obrigatorio, estado: 'inconclusivo', comando: [], exitCode: null, sinal: '', timeout: false, duracaoMs: 0, saida: 'sem comando verificavel' }
      if (c.naoAplicavel && !c.obrigatorio) { e.estado = 'nao-aplicavel'; e.saida = c.naoAplicavel }
      else if (c.comando) {
        const inicio = Date.now()
        const cmd = c.comando
        e.comando = [cmd.binario, ...cmd.argumentos].map(ocultarSegredos)
        try {
          const cwd = dentroDoWorktree(wt, cmd.diretorio)
          const r = await executar(cmd.binario, cmd.argumentos, { cwd, timeout: cmd.timeoutMs, aoEstourarTempo: () => { e.timeout = true } })
          e.exitCode = r.err ? (typeof r.err.code === 'number' ? r.err.code : null) : 0
          e.sinal = r.err?.signal ?? ''
          e.estado = !r.err && !e.timeout ? 'aprovado' : e.timeout || e.exitCode === null ? 'inconclusivo' : 'reprovado'
          e.saida = ocultarSegredos([r.stdout, r.stderr, r.err?.message ?? ''].filter(Boolean).join('\n')).slice(-32000)
        } catch (erro) { e.saida = ocultarSegredos((erro as Error).message) }
        e.duracaoMs = Date.now() - inicio
      }
      evidencias.push(e)
      saida(atividade, e.estado === 'aprovado' ? 'stdout' : 'error', e.saida)
      atualizar(atividade, a => { a.detalhes.exitCode = e.exitCode; a.detalhes.timeout = e.timeout; a.detalhes.duracaoMs = e.duracaoMs })
    }
    const mudou = fingerprint !== await fingerprintDoTrabalho(wt)
    if (mudou) for (const e of evidencias) { e.estado = 'inconclusivo'; e.saida += '\nO trabalho mudou durante a verificacao; execute novamente.' }
    for (const [i, e] of evidencias.entries()) terminar(atividades[i] ?? '', e.estado === 'aprovado' ? 'succeeded' : e.estado === 'nao-aplicavel' ? 'skipped' : 'failed', e.estado)
    const relatorio: RelatorioDeEvidencias = { versao: 1, plano: plano.id, revisao, fingerprint, instante: new Date().toISOString(), evidencias,
      aprovado: evidencias.every(e => !e.obrigatorio || e.estado === 'aprovado') }
    mkdirSync(join(cardsDir(), 'evidencias'), { recursive: true })
    writeFileAtomic(arquivoDeEvidencias(plano.id, revisao), JSON.stringify(relatorio, null, 2) + '\n')
    registrarArtefato({ repo: plano.repo, sessao: plano.sessaoId, execucao: plano.id }, `evidencias-revisao-${revisao}`, 'application/json', JSON.stringify(relatorio))
    return relatorio
  } finally { for (const id of atividades) terminar(id, 'failed', 'verificacao interrompida antes de concluir') }
}

export async function evidenciaAtual(id: string, revisao: number, wt: string): Promise<boolean> {
  const arquivo = arquivoDeEvidencias(id, revisao)
  if (!existsSync(arquivo)) return false
  const r = JSON.parse(readFileSync(arquivo, 'utf8')) as RelatorioDeEvidencias
  return r.versao === 1 && r.plano === id && r.revisao === revisao && r.aprovado === true && r.fingerprint === await fingerprintDoTrabalho(wt)
}

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoStatus } from '../../cdl/repos.ts'
import { readContract } from '../../cdl/bss/armazenar.ts'
import { lerProjectConfig } from '../../cdl/ali/home.ts'
import { motivoDoErro } from '../../cdl/ali/aviso.ts'
import { orcamentoDeRecurso, quantosWorktreesCabem, relatoDeLimites, tetoDeParalelismo } from '../../qlb/limites.ts'
import { MAX_CONCURRENCY } from '../../cdl/ali/config.ts'
import { repoBase } from '../../cdl/store.ts'
import { taskSyncName } from '../../tmd/pnt/tarefas/registro.ts'
import { daemonStatus } from '../../osw/mtr/daemon.ts'
import { harnessPorNome, providerNameFor } from '../../tmd/registro.ts'

export type Severity = 'ok' | 'aviso' | 'erro'

export interface Check {
  nome: string
  severidade: Severity
  detalhe: string
  conserto: string
}

const NONINTERACTIVE = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' }

function exec(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...NONINTERACTIVE }, timeout: 20000,
    })
    return { ok: true, out: out.trim() }
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string }
    return { ok: false, out: String(err.stderr || err.stdout || err.message || '').trim() }
  }
}

function check(nome: string, severidade: Severity, detalhe: string, conserto = ''): Check {
  return { nome, severidade, detalhe, conserto }
}

export function checkGh(): Check {
  const versao = exec('gh', ['--version'])
  if (!versao.ok) return check('gh', 'erro', 'gh CLI nao encontrado', 'instale o gh — sem ele o motor nao abre PR')
  const auth = exec('gh', ['auth', 'status'])
  if (!auth.ok) return check('gh', 'erro', 'gh nao autenticado', 'gh auth login')
  const quem = auth.out.match(/account (\S+)|as (\S+)/)
  const nome = quem?.[1] ?? quem?.[2] ?? 'ok'
  return check('gh', 'ok', `autenticado (${nome})`)
}

export function checkGitPush(repoPath: string, repoName: string): Check {
  if (!existsSync(join(repoPath, '.git'))) return check('git push', 'erro', 'clone ausente', `hii repo add ${repoName} --path <dir>`)
  const probe = exec('git', ['push', '--dry-run', 'origin', 'HEAD:refs/heads/__hicode_probe__'], repoPath)
  if (!probe.ok) {
    const semCredencial = /could not read Username|Authentication failed|Permission denied|terminal prompts disabled/i.test(probe.out)
    return check(
      'git push',
      'erro',
      semCredencial ? 'git nao autentica no remoto sem prompt — o push do PR vai falhar' : `push recusado: ${probe.out.split('\n').pop()?.slice(0, 90)}`,
      semCredencial ? 'gh auth setup-git   (faz o git usar o token do gh)' : 'confira permissao de escrita e o remote origin',
    )
  }
  const perm = exec('gh', ['repo', 'view', repoName, '--json', 'viewerPermission', '-q', '.viewerPermission'])
  return check('git push', 'ok', perm.ok ? `autentica e escreve (${perm.out})` : 'autentica sem prompt')
}

export function checkProvider(): Check {
  const papeis = ['implement', 'verify', 'gate', 'step'] as const
  const nomes = [...new Set(papeis.map(p => providerNameFor(p)))]
  const faltando = nomes
    .map(n => harnessPorNome(n))
    .filter(h => h.exigeCliNoPath && !exec(h.binario, ['--version']).ok)
    .map(h => h.name)
  if (faltando.length) {
    return check('IA', 'erro', `CLI ausente: ${faltando.join(', ')}`, `instale ou troque o provedor por papel (HICODE_*_PROVIDER)`)
  }
  return check('IA', 'ok', `provedores: ${nomes.join(', ')}`)
}

export function checkContract(repoPath: string): Check {
  const c = readContract(repoPath)
  if (!c) return check('contrato', 'aviso', 'nao gerado', `hii contract ${repoPath}`)
  if (!c.commands.build && !c.commands.test) {
    return check('contrato', 'aviso', `${c.stack} — sem build nem test`, 'os gates de build/teste serao pulados')
  }
  return check('contrato', 'ok', c.stack)
}

// `.hii/config.json` era escrito por `hii init` e lido por `readProjectConfig`,
// que nao tinha nenhum consumidor de producao: o operador escrevia provider, base
// e taskSource ali e NADA acontecia. Aqui o arquivo passa a ser conferido contra
// o que o motor de fato usa, e a divergencia sai nomeada — sem trocar a rota, que
// continua sendo config/repos.json e as preferencias de ia.
export function checkProjectConfig(repoPath: string, repoName: string): Check {
  const leitura = lerProjectConfig(repoPath)
  if (leitura.ilegivel) {
    return check('.hii/config.json', 'aviso', `o arquivo existe e NAO deu para ler (${leitura.ilegivel}) — nao da para saber o que o projeto declarou`, 'conserte o JSON ou apague o arquivo')
  }
  const c = leitura.config
  const declarados = Object.entries(c).filter(([, v]) => String(v ?? '').trim())
  if (!declarados.length) return check('.hii/config.json', 'ok', 'sem preferencia declarada — vale o global')
  const divergencias: string[] = []
  const baseReal = repoBase(repoName)
  if (c.base && c.base !== baseReal) {
    divergencias.push(`base "${c.base}" != "${baseReal}" (quem manda e config/repos.json)`)
  }
  const provedorReal = providerNameFor('implement')
  if (c.provider && c.provider !== provedorReal) {
    divergencias.push(`provider "${c.provider}" != "${provedorReal}" (quem manda e config/ia.json ou a env)`)
  }
  if (c.taskSource && c.taskSource !== 'cards' && c.taskSource !== taskSyncName()) {
    divergencias.push(`taskSource "${c.taskSource}" != HICODE_TASK_SYNC="${taskSyncName()}"`)
  }
  if (!divergencias.length) return check('.hii/config.json', 'ok', `${declarados.length} preferencia(s), todas coerentes`)
  return check(
    '.hii/config.json',
    'aviso',
    `o arquivo do projeto diz uma coisa e o motor usa outra: ${divergencias.join(' · ')}`,
    'alinhe o .hii/config.json com config/repos.json e config/ia.json — o motor NAO le este arquivo para rotear',
  )
}

// `relatoDeLimites` era relatorio calculado sem consumidor. O `doctor` e o lugar
// natural: e ele que diz ao operador por que o motor nao anda mais rapido.
export function checkRecurso(): Check {
  // `quantosWorktreesCabem` LANCA em orcamento invalido (memoria/cpu por worktree
  // <= 0), e o doctor existe justamente para ser rodado quando algo esta errado —
  // ele nao pode morrer por causa do que veio checar.
  try {
    return recursoOuAviso()
  } catch (e) {
    return check('recurso', 'erro', `orcamento de recurso invalido: ${motivoDoErro(e as Error)}`, 'confira HICODE_MEM_POR_WORKTREE_MB e HICODE_CPU_POR_WORKTREE')
  }
}

function recursoOuAviso(): Check {
  const teto = tetoDeParalelismo(MAX_CONCURRENCY)
  const cabem = quantosWorktreesCabem(orcamentoDeRecurso()).cabem
  const detalhe = `${teto} worktree(s) em paralelo (HICODE_CONCURRENCY=${MAX_CONCURRENCY}, cabem ${cabem} no recurso declarado)`
  if (teto < MAX_CONCURRENCY) {
    return check('recurso', 'aviso', `${detalhe} — o RECURSO limita, nao a sua configuracao`, relatoDeLimites().split('\n')[1] ?? '')
  }
  return check('recurso', 'ok', detalhe)
}

export function checkDaemon(): Check {
  const s = daemonStatus()
  return s === 'offline'
    ? check('daemon', 'aviso', 'offline — cards ficam na fila', 'hii start')
    : check('daemon', 'ok', s)
}

export interface RepoReport {
  repo: string
  checks: Check[]
}

export interface Report {
  gerais: Check[]
  repos: RepoReport[]
  pior: Severity
}

function pior(checks: Check[]): Severity {
  if (checks.some(c => c.severidade === 'erro')) return 'erro'
  if (checks.some(c => c.severidade === 'aviso')) return 'aviso'
  return 'ok'
}

export function runDoctor(): Report {
  const gerais = [checkGh(), checkProvider(), checkRecurso(), checkDaemon()]
  const repos = repoStatus().map(r => ({
    repo: r.name,
    checks: [checkGitPush(r.path, r.name), checkContract(r.path), checkProjectConfig(r.path, r.name)],
  }))
  return { gerais, repos, pior: pior([...gerais, ...repos.flatMap(r => r.checks)]) }
}

export function podeAbrirPr(repoPath: string, repoName: string): Check {
  return checkGitPush(repoPath, repoName)
}

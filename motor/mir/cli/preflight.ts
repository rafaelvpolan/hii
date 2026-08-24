import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { ROOT } from '../../cdl/ali/config'
import { provedoresDisponiveis } from '../../tmd/disponibilidade'
import { urlDoOllama } from '../../tmd/harness/ollama-estado'
import { rotuloDoBloqueio } from '../despacho'
import type { Check, Severity } from '../../euc/rdr/doctor'
import { runtimeDeScript } from '../../cdl/ali/runtime'

export type { Severity as Severidade, Check as ChecagemDeAmbiente } from '../../euc/rdr/doctor'

function estaNoPath(binario: string): boolean {
  const caminhos = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return caminhos.some(dir => existsSync(join(dir, binario)))
}

function checarBinario(nome: string, conserto: string, seAusente: Severity = 'erro'): Check {
  return estaNoPath(nome)
    ? { nome, severidade: 'ok', detalhe: 'no PATH', conserto: '' }
    : { nome, severidade: seAusente, detalhe: 'ausente do PATH', conserto }
}

export function checarIa(ollamaAlcancavel = false): Check {
  const provedores = provedoresDisponiveis()
  const prontas = provedores.filter(p => p.situacao === 'disponivel')
  if (prontas.length) return { nome: 'IA', severidade: 'ok', detalhe: `disponiveis: ${prontas.map(p => p.nome).join(', ')}`, conserto: '' }
  if (ollamaAlcancavel) return { nome: 'IA', severidade: 'ok', detalhe: `disponivel: ollama (${urlDoOllama()})`, conserto: '' }
  const instaladas = provedores.filter(p => p.situacao === 'nao-autenticado' || p.situacao === 'cota-esgotada')
  if (instaladas.length) {
    const detalhe = instaladas.map(p => `${p.nome} ${rotuloDoBloqueio(p.situacao)}`).join(', ')
    return { nome: 'IA', severidade: 'aviso', detalhe, conserto: '/login dentro do hii resolve — o envio de prompt fica bloqueado ate la' }
  }
  return { nome: 'IA', severidade: 'erro', detalhe: 'nenhuma IA disponivel', conserto: 'instale claude, codex ou kimi — ou suba o ollama' }
}

export function checarDependencias(root = ROOT): Check {
  if (!existsSync(join(root, 'node_modules'))) {
    return { nome: 'dependencias', severidade: 'aviso', detalhe: `node_modules ausente em ${root}`, conserto: `cd ${root} && bun install` }
  }
  try {
    execFileSync(runtimeDeScript(), [join(root, 'scripts', 'check-clone-limpo.mjs')], { cwd: root, stdio: 'ignore', timeout: 10000 })
    return { nome: 'dependencias', severidade: 'ok', detalhe: 'clone consistente (lockfile, links, CI)', conserto: '' }
  } catch (erro) {
    const naoRodou = (erro as { code?: string }).code === 'ENOENT'
    return naoRodou
      ? { nome: 'dependencias', severidade: 'erro', detalhe: 'nao consegui rodar o lint de clone (bun ausente?)', conserto: 'instale o bun (https://bun.sh)' }
      : { nome: 'dependencias', severidade: 'aviso', detalhe: 'lint clone-limpo encontrou problema(s) (lockfile, links ou CI)', conserto: 'bun run lint:clone   (detalha o problema)' }
  }
}

export function preflight(ollamaAlcancavel = false, root = ROOT): Check[] {
  return [
    checarBinario(runtimeDeScript(), 'instale bun (https://bun.sh) ou use node 24+ com HICODE_RUNTIME=node'),
    checarBinario('git', 'instale o git'),
    checarBinario('gh', 'instale o gh CLI', 'aviso'),
    checarIa(ollamaAlcancavel),
    checarDependencias(root),
  ]
}

export function bloqueia(checks: Check[]): boolean {
  return checks.some(c => c.severidade === 'erro')
}

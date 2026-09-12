import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { memoTempo } from '../tomada/eco/memo.ts'
import type { RuntimeDeclarado } from '../cordel/bussola/tipos.ts'

// Quilombo — o comando do alvo roda sob a versao que o pacote declarou, sem tocar
// no estado global do host. `nvm use` muda o shell inteiro: dois worktrees em
// paralelo, um em Node 16 e outro em 20, derrubavam um ao outro. Aqui cada
// comando e envolvido no `exec` do gerente (ou recebe a variavel de versao que o
// gerente le), e nada fora daquele processo muda.

export type Gerente = 'mise' | 'asdf' | 'fnm' | 'volta' | 'nvm' | 'phpenv'

export interface GerentesDoHost {
  readonly disponiveis: readonly Gerente[]
  readonly nvmSh: string
}

export interface ComandoEnvolvido {
  readonly cmd: string
  readonly args: string[]
  readonly env: Record<string, string>
  readonly rotulo: string
  readonly avisos: string[]
}

const BINARIOS: readonly Gerente[] = ['mise', 'asdf', 'fnm', 'volta', 'phpenv']

function noPath(binario: string, path: string): boolean {
  return path.split(':').some(d => d && existsSync(join(d, binario)))
}

function caminhoDoNvm(env: NodeJS.ProcessEnv): string {
  const candidatos = [env.NVM_DIR ? join(env.NVM_DIR, 'nvm.sh') : '', env.HOME ? join(env.HOME, '.nvm', 'nvm.sh') : '', '/usr/local/opt/nvm/nvm.sh']
  return candidatos.find(c => c && existsSync(c)) ?? ''
}

export function sondarGerentesAgora(env: NodeJS.ProcessEnv = process.env): GerentesDoHost {
  const path = env.PATH ?? ''
  const disponiveis: Gerente[] = BINARIOS.filter(b => noPath(b, path))
  const nvmSh = caminhoDoNvm(env)
  if (nvmSh) disponiveis.push('nvm')
  return { disponiveis, nvmSh }
}

// Sondar o PATH a cada comando seria stat por diretorio por binario; a resposta
// nao muda no meio de uma execucao.
export const sondarGerentes: () => GerentesDoHost = memoTempo(() => sondarGerentesAgora(), 30_000)

const PARA_NODE: readonly Gerente[] = ['mise', 'asdf', 'fnm', 'volta', 'nvm']
const PARA_PHP: readonly Gerente[] = ['mise', 'asdf', 'phpenv']

function primeiro(g: GerentesDoHost, ordem: readonly Gerente[]): Gerente | '' {
  return ordem.find(x => g.disponiveis.includes(x)) ?? ''
}

interface Camada {
  readonly envolver: (cmd: string, args: string[]) => { cmd: string; args: string[] }
  readonly env: Record<string, string>
}

function camadaDe(gerente: Gerente, r: RuntimeDeclarado, g: GerentesDoHost): Camada {
  const identidade = (cmd: string, args: string[]): { cmd: string; args: string[] } => ({ cmd, args })
  switch (gerente) {
    case 'mise': return { envolver: (cmd, args) => ({ cmd: 'mise', args: ['exec', `${r.linguagem}@${r.versao}`, '--', cmd, ...args] }), env: {} }
    case 'asdf': return { envolver: identidade, env: { [r.linguagem === 'node' ? 'ASDF_NODEJS_VERSION' : 'ASDF_PHP_VERSION']: r.versao } }
    case 'fnm': return { envolver: (cmd, args) => ({ cmd: 'fnm', args: ['exec', '--using', r.versao, '--', cmd, ...args] }), env: {} }
    case 'volta': return { envolver: (cmd, args) => ({ cmd: 'volta', args: ['run', '--node', r.versao, cmd, ...args] }), env: {} }
    case 'nvm': return {
      // `bash -c '<script>' $0 $1 $2...`: $0 e o nvm.sh, $1 a versao, o resto e o
      // comando com os argumentos INTACTOS — sem passar por uma segunda expansao.
      envolver: (cmd, args) => ({ cmd: 'bash', args: ['-c', 'source "$0" >/dev/null 2>&1 && nvm exec --silent "$1" "${@:2}"', g.nvmSh, r.versao, cmd, ...args] }),
      env: {},
    }
    case 'phpenv': return { envolver: identidade, env: { PHPENV_VERSION: r.versao } }
  }
}

export function envolverComRuntime(cmd: string, args: string[], runtimes: readonly RuntimeDeclarado[] | undefined, g: GerentesDoHost = sondarGerentes()): ComandoEnvolvido {
  let atual = { cmd, args: [...args] }
  const env: Record<string, string> = {}
  const rotulos: string[] = []
  const avisos: string[] = []
  // PHP por dentro, Node por fora: a camada de env e neutra na ordem; a de exec
  // fica ao redor de tudo. Quem mais precisa de `exec` (node via nvm/fnm/volta) e
  // aplicado por ultimo, para ser o processo externo.
  const ordenados = [...(runtimes ?? [])].sort((a, b) => (a.linguagem === 'php' ? -1 : 0) - (b.linguagem === 'php' ? -1 : 0))
  for (const r of ordenados) {
    if (!r.versao) continue
    const gerente = primeiro(g, r.linguagem === 'node' ? PARA_NODE : PARA_PHP)
    if (!gerente) {
      const lista = (r.linguagem === 'node' ? PARA_NODE : PARA_PHP).join('/')
      avisos.push(`${r.linguagem} ${r.versao} declarado em ${r.fonte}, mas nenhum gerente (${lista}) foi encontrado — rodando com o ${r.linguagem} do PATH`)
      rotulos.push(`${r.linguagem} ${r.versao} sem gerente`)
      continue
    }
    const camada = camadaDe(gerente, r, g)
    atual = camada.envolver(atual.cmd, atual.args)
    Object.assign(env, camada.env)
    rotulos.push(`${r.linguagem} ${r.versao} via ${gerente}`)
  }
  return { cmd: atual.cmd, args: atual.args, env, rotulo: rotulos.join(' · '), avisos }
}

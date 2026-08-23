import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, ROOT } from '../cdl/ali/config'
import { ENV_CARDS_DIR } from '../cdl/ali/contrato'

export interface EstadoVazio {
  vazio: boolean
  apontadoPorEnv: boolean
  caminho: string
  outroEstado: string
}

const IRMAOS = ['hicode', 'hii']

function temCards(dir: string): boolean {
  if (!existsSync(dir)) return false
  return readdirSync(dir).some(f => f.endsWith('.md'))
}

export function procurarOutroEstado(raiz = ROOT): string {
  const pai = join(raiz, '..')
  for (const nome of IRMAOS) {
    const candidato = join(pai, nome, 'cards')
    if (candidato !== cardsDir() && temCards(candidato)) return candidato
  }
  return ''
}

export function lerEstadoVazio(): EstadoVazio {
  const caminho = cardsDir()
  return {
    vazio: !temCards(caminho),
    apontadoPorEnv: !!process.env[ENV_CARDS_DIR],
    caminho,
    outroEstado: procurarOutroEstado(),
  }
}

export function avisoDeEstadoVazio(e: EstadoVazio): string[] {
  if (!e.vazio) return []
  if (e.apontadoPorEnv) {
    return [
      `nenhum card em ${e.caminho}`,
      `${ENV_CARDS_DIR} esta apontando para la — confira o caminho ou escreva a primeira tarefa`,
    ]
  }
  if (!e.outroEstado) {
    return [`nenhum card ainda em ${e.caminho} — escreva a primeira tarefa`]
  }
  return [
    `nenhum card em ${e.caminho}, mas achei cards em ${e.outroEstado}`,
    `para usar esses, exporte: ${ENV_CARDS_DIR}="${e.outroEstado}"`,
    'ou escreva a primeira tarefa e comece o arquivo deste clone',
  ]
}

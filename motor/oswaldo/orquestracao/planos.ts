import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { withFileLock, writeFileAtomic } from '../mutirao/trava-arquivo.ts'
import { chaveDoProjeto } from './config.ts'
import { ErroDeContrato, idValido, validarPlano } from './contrato.ts'
import type { PlanoDeExecucao } from './contrato.ts'

export interface RevisaoDePlano {
  revisao: number
  chave: string
  hash: string
  plano: PlanoDeExecucao
}

interface HistoricoDePlano {
  versao: 1
  revisoes: RevisaoDePlano[]
}

function arquivo(repo: string, id: string): string {
  if (!idValido(id)) throw new ErroDeContrato('invalido', 'id', 'ID invalido')
  return join(cardsDir(), 'planos', `${chaveDoProjeto(repo)}-${id}.json`)
}

function historico(repo: string, id: string): HistoricoDePlano {
  const caminho = arquivo(repo, id)
  if (!existsSync(caminho)) return { versao: 1, revisoes: [] }
  const h = JSON.parse(readFileSync(caminho, 'utf8')) as HistoricoDePlano
  if (h?.versao !== 1 || !Array.isArray(h.revisoes)) throw new ErroDeContrato('versao-incompativel', 'historico', 'formato nao suportado')
  for (const [indice, r] of h.revisoes.entries()) {
    validarPlano(r.plano)
    if (r.plano.repo !== repo || r.plano.id !== id) throw new ErroDeContrato('invalido', 'historico', 'projeto/ID divergentes')
    if (r.revisao !== indice + 1 || r.hash !== createHash('sha256').update(JSON.stringify(r.plano)).digest('hex')) throw new ErroDeContrato('invalido', 'historico', 'revisao ou hash divergente')
  }
  return h
}

export function lerPlano(repo: string, id: string, revisao?: number): RevisaoDePlano | null {
  const h = historico(repo, id)
  return (revisao === undefined ? h.revisoes.at(-1) : h.revisoes.find(r => r.revisao === revisao)) ?? null
}

export function salvarPlano(plano: PlanoDeExecucao, revisaoEsperada: number, chave: string): RevisaoDePlano {
  validarPlano(plano)
  if (!chave.trim()) throw new ErroDeContrato('invalido', 'chave', 'idempotencia obrigatoria')
  mkdirSync(join(cardsDir(), 'planos'), { recursive: true })
  const caminho = arquivo(plano.repo, plano.id)
  return withFileLock(caminho, () => {
    const h = historico(plano.repo, plano.id)
    const hash = createHash('sha256').update(JSON.stringify(plano)).digest('hex')
    const repetida = h.revisoes.find(r => r.chave === chave)
    if (repetida) {
      if (repetida.hash !== hash) throw new ErroDeContrato('conflito', 'chave', 'chave ja usada para outro conteudo')
      return repetida
    }
    const atual = h.revisoes.at(-1)?.revisao ?? 0
    if (atual !== revisaoEsperada) throw new ErroDeContrato('conflito', 'revisao', `esperada ${revisaoEsperada}, atual ${atual}`)
    const nova: RevisaoDePlano = { revisao: atual + 1, chave, hash, plano }
    h.revisoes.push(nova)
    writeFileAtomic(caminho, JSON.stringify(h, null, 2) + '\n')
    return nova
  })
}

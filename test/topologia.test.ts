import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { lerTopologia, transicaoPermitida, destinosDe } from '../motor/nmy/topologia'
import { STATUSES } from '../motor/cdl'
import type { Status } from '../motor/cdl'
import { activeSteps } from '../motor/nmy/config'
import { waves as ondas } from '../motor/nmy/luc/ondas'

const topo = lerTopologia()

function arquivosDoMotor(dir = 'motor'): string[] {
  const acc: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) acc.push(...arquivosDoMotor(p))
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

function estadosEscritosPeloMotor(): Set<Status> {
  const escritos = new Set<Status>()
  for (const arquivo of arquivosDoMotor()) {
    for (const m of readFileSync(arquivo, 'utf8').matchAll(/status: '([A-Z_]+)'/g)) {
      const s = m[1]
      if (s && (STATUSES as readonly string[]).includes(s)) escritos.add(s as Status)
    }
  }
  return escritos
}

test('a varredura do motor enxerga escrita de estado — senao os testes FOTO passariam vazios', () => {
  const escritos = estadosEscritosPeloMotor()
  expect(escritos.size, 'regex de varredura quebrou: nenhum `status:` encontrado em motor/').toBeGreaterThan(8)
  expect([...escritos]).toContain('EXECUTING')
  expect([...escritos]).toContain('PR_OPEN')
})

test('todo estado do card e um no declarado, e todo no e um estado real', () => {
  expect([...topo.nos].sort()).toEqual([...STATUSES].sort())
})

test('FOTO todo estado que o motor escreve e destino de alguma transicao declarada', () => {
  const alcancaveis = new Set<Status>([...topo.transicoes.map(([, para]) => para), ...topo.sempreAlcancavel])
  const semDeclaracao = [...estadosEscritosPeloMotor()].filter(s => !alcancaveis.has(s))
  expect(semDeclaracao, 'o motor escreve estes estados e a topologia nao declara como se chega neles').toEqual([])
})

test('FOTO estado listado como sem escrita no motor realmente nao e escrito por ninguem', () => {
  const escritos = estadosEscritosPeloMotor()
  const mentirosos = topo.semEscritaNoMotor.estados.filter(s => escritos.has(s))
  expect(mentirosos, 'declarados como nao escritos, mas ha codigo escrevendo — a foto envelheceu').toEqual([])
})

test('FOTO a cadeia de polimento do pipeline.json esta declarada de ponta a ponta', () => {
  const cadeia = ondas(activeSteps()).flat().map(s => s.state)
  const caminho: Status[] = ['URL_OK', ...cadeia]
  const faltando: string[] = []
  for (let i = 0; i + 1 < caminho.length; i++) {
    const de = caminho[i]
    const para = caminho[i + 1]
    if (de && para && !transicaoPermitida(topo, de, para)) faltando.push(`${de} -> ${para}`)
  }
  expect(faltando, 'passo do pipeline muda o card para um estado que a topologia nao permite').toEqual([])
})

test('o ultimo estado do pipeline chega em PR_OPEN, que e checkpoint humano', () => {
  const cadeia = ondas(activeSteps()).flat().map(s => s.state)
  const ultimo = cadeia[cadeia.length - 1]
  expect(ultimo && transicaoPermitida(topo, ultimo, 'PR_OPEN')).toBe(true)
  expect(topo.checkpointsHumanos).toContain('PR_OPEN')
})

test('transicao nao declarada e rejeitada — a topologia serve pra barrar deriva', () => {
  expect(transicaoPermitida(topo, 'READY', 'PR_OPEN')).toBe(false)
  expect(transicaoPermitida(topo, 'INBOX', 'MERGED')).toBe(false)
  expect(transicaoPermitida(topo, 'READY', 'EXECUTING')).toBe(true)
})

test('HALTED e PAUSED sao alcancaveis de qualquer estado — parar nunca depende de rota', () => {
  for (const de of STATUSES) {
    expect(transicaoPermitida(topo, de, 'HALTED'), `${de} -> HALTED`).toBe(true)
  }
})

test('destinosDe nunca inclui o proprio estado', () => {
  for (const de of STATUSES) expect(destinosDe(topo, de)).not.toContain(de)
})

test('nenhum checkpoint humano fica sem saida declarada', () => {
  for (const c of topo.checkpointsHumanos) {
    expect(destinosDe(topo, c).length, `${c} nao tem para onde ir`).toBeGreaterThan(0)
  }
})

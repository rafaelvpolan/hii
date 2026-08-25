import { test, expect } from '../apoio/runner.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { lerTopologia, transicaoPermitida, destinosDe, todasAsTransicoes } from '../../motor/nmy/topologia.ts'
import { conferirTransicao, esquecerTopologia, observarDeriva } from '../../motor/nmy/deriva-de-transicao.ts'
import { STATUSES } from '../../motor/cdl/index.ts'
import type { Status } from '../../motor/cdl/index.ts'
import { activeSteps } from '../../motor/nmy/config.ts'
import { waves as ondas } from '../../motor/nmy/luc/ondas.ts'

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

// Este teste comparava so o DESTINO, e por construcao nao podia reprovar nada:
// HALTED e PAUSED estao em `sempreAlcancavel`, e todo estado do pipeline e
// destino de alguma transicao. O motor executava 17 transicoes que a topologia
// nao declarava — cinco em todo reinicio de daemon — e ele passava verde.
//
// Ficou como e: barato, e cobre o caso de estado orfao. O que passou a valer como
// guarda de deriva sao os dois testes de PAR mais abaixo.
test('FOTO todo estado que o motor escreve e destino de alguma transicao declarada', () => {
  const alcancaveis = new Set<Status>([...todasAsTransicoes(topo).map(([, para]) => para), ...topo.sempreAlcancavel])
  const semDeclaracao = [...estadosEscritosPeloMotor()].filter(s => !alcancaveis.has(s))
  expect(semDeclaracao, 'o motor escreve estes estados e a topologia nao declara como se chega neles').toEqual([])
})

test('PAR o par (origem, destino) escrito no log do motor esta declarado — nao so o destino', () => {
  const naoDeclarados: string[] = []
  for (const arquivo of arquivosDoMotor()) {
    for (const m of readFileSync(arquivo, 'utf8').matchAll(/\b([A-Z_]{3,})->([A-Z_]{3,})\b/g)) {
      const de = m[1]
      const para = m[2]
      if (!de || !para) continue
      if (!(STATUSES as readonly string[]).includes(de) || !(STATUSES as readonly string[]).includes(para)) continue
      if (!transicaoPermitida(topo, de as Status, para as Status)) naoDeclarados.push(`${arquivo}: ${de}->${para}`)
    }
  }
  expect(naoDeclarados, 'o log do card anuncia esta transicao ao humano e a topologia nao a declara').toEqual([])
})

test('a varredura de PAR enxerga pares de verdade — senao ela passaria vazia', () => {
  let pares = 0
  for (const arquivo of arquivosDoMotor()) {
    for (const m of readFileSync(arquivo, 'utf8').matchAll(/\b([A-Z_]{3,})->([A-Z_]{3,})\b/g)) {
      if ((STATUSES as readonly string[]).includes(m[1] ?? '') && (STATUSES as readonly string[]).includes(m[2] ?? '')) pares++
    }
  }
  expect(pares, 'nenhum par encontrado: a regex quebrou e o invariante acima vale nada').toBeGreaterThan(10)
})

// O par existe de verdade num lugar so: no ponto de escrita do card, que conhece
// o estado anterior. Aqui o observador e exercitado, para a guarda poder REPROVAR
// em vez de so descrever.
test('OBSERVADOR transicao nao declarada e detectada no ponto de escrita', () => {
  esquecerTopologia()
  const vistas: string[] = []
  observarDeriva(d => vistas.push(`${d.de}->${d.para}`))
  try {
    expect(conferirTransicao('READY', 'EXECUTING'), 'declarada: nao e deriva').toBeNull()
    expect(conferirTransicao('URL_OK', 'WAITING'), 'declarada como recuperacao: nao e deriva').toBeNull()
    expect(conferirTransicao('READY', 'DEPLOYED'), 'READY->DEPLOYED nao existe em lugar nenhum').toEqual({ de: 'READY', para: 'DEPLOYED' })
    expect(conferirTransicao('EXECUTING', 'HALTED'), 'HALTED e sempre alcancavel').toBeNull()
    expect(conferirTransicao('READY', 'READY'), 'o mesmo estado nao e transicao').toBeNull()
    expect(conferirTransicao('READY', 'NAO_E_STATUS'), 'texto que nao e status nao vira alarme').toBeNull()
    expect(vistas).toEqual(['READY->DEPLOYED'])
  } finally {
    observarDeriva(null)
    esquecerTopologia()
  }
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

// A validacao de lerTopologia e o que torna o arquivo "dado inspecionavel" em
// vez de JSON solto — e nao tinha teste nenhum. Este e justamente o caminho de
// erro que motivou declarar a topologia como dado: alguem editar o JSON errado.
function comTopologia<T>(conteudo: string, corpo: () => T): T {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'hii-topo-'))
  const arquivo = join(dir, 'topologia.json')
  writeFileSync(arquivo, conteudo)
  const anterior = process.env.HICODE_TOPOLOGIA_FILE
  process.env.HICODE_TOPOLOGIA_FILE = arquivo
  try {
    return corpo()
  } finally {
    if (anterior === undefined) delete process.env.HICODE_TOPOLOGIA_FILE
    else process.env.HICODE_TOPOLOGIA_FILE = anterior
    rmSync(dir, { recursive: true, force: true })
  }
}

test('estado inexistente em `nos` e recusado, dizendo qual', () => {
  comTopologia(JSON.stringify({ nos: ['READY', 'ESTADO_INVENTADO'], transicoes: [] }), () => {
    expect(() => lerTopologia()).toThrow('ESTADO_INVENTADO')
  })
})

test('estado inexistente dentro de uma transicao e recusado, dizendo em qual indice', () => {
  comTopologia(JSON.stringify({ nos: [], transicoes: [['READY', 'EXECUTING'], ['READY', 'NAO_EXISTE']] }), () => {
    expect(() => lerTopologia()).toThrow('transicoes[1]')
  })
})

test('transicao que nao e par de dois e recusada', () => {
  comTopologia(JSON.stringify({ nos: [], transicoes: [['READY']] }), () => {
    expect(() => lerTopologia()).toThrow('nao e um par')
  })
})

test('checkpointsHumanos e sempreAlcancavel tambem sao validados contra STATUSES', () => {
  comTopologia(JSON.stringify({ nos: [], transicoes: [], checkpointsHumanos: ['FANTASMA'] }), () => {
    expect(() => lerTopologia()).toThrow('checkpointsHumanos')
  })
  comTopologia(JSON.stringify({ nos: [], transicoes: [], sempreAlcancavel: ['FANTASMA'] }), () => {
    expect(() => lerTopologia()).toThrow('sempreAlcancavel')
  })
})

test('topologia vazia e valida — ausencia de campo nao e erro, so nao declara nada', () => {
  comTopologia('{}', () => {
    const t = lerTopologia()
    expect(t.nos).toEqual([])
    expect(t.transicoes).toEqual([])
  })
})

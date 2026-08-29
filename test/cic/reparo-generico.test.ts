import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-reparo-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { repararAteOTeto, reprovado, inconclusivo, APROVADO, relatoParaHumano } = await import('../../motor/cic/reparo.ts')
const { eventosDoCard } = await import('../../motor/euc/eventos.ts')

interface Roteiro { veredictos: ReturnType<typeof reprovado>[]; consertos: number }

function gateQueSegue(roteiro: Roteiro, nome = 'testes'): Parameters<typeof repararAteOTeto>[0] {
  let i = 0
  return {
    nome,
    rodar: (): Promise<ReturnType<typeof reprovado>> => Promise.resolve(roteiro.veredictos[i++] ?? APROVADO),
    consertoEstreito: (): Promise<string> => { roteiro.consertos++; return Promise.resolve('ajustou o que o veredicto apontou') },
  }
}

test('gate que ja passa nao dispara reparo nenhum', async () => {
  const roteiro: Roteiro = { veredictos: [APROVADO], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 2)
  expect(r.veredicto.status).toBe('ok')
  expect(r.tentativas).toBe(0)
  expect(roteiro.consertos).toBe(0)
})

test('uma reprovacao vira uma tentativa dirigida, e o gate roda de novo', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('typecheck: 3 erros'), APROVADO], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 2)
  expect(roteiro.consertos).toBe(1)
  expect(r.tentativas).toBe(1)
  expect(r.veredicto.status).toBe('ok')
})

// Veredictos DISTINTOS de proposito. Enquanto o roteiro repetia a mesma frase 20
// vezes, este teste media a parada por nao-progresso acreditando medir o teto —
// as duas guardas ficavam cobertas pela mesma assercao, e mexer numa quebrava a
// outra sem dizer qual. Cada uma tem o seu caso agora.
test('REGRESSAO o teto e respeitado — o loop nao roda para sempre', async () => {
  const roteiro: Roteiro = { veredictos: Array.from({ length: 20 }, (_, n) => reprovado(`falha diferente ${n}`)), consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 3)
  expect(roteiro.consertos, 'consertou mais vezes que o teto').toBe(3)
  expect(r.tentativas).toBe(3)
  expect(r.veredicto.status).toBe('falhou')
  expect(r.semProgresso, 'houve progresso a cada volta — parou pelo teto, nao por repeticao').toBe(false)
})

test('o laco para quando o gate REPETE a reprovacao — teto cego pagava as voltas restantes para ouvir o mesmo', async () => {
  const roteiro: Roteiro = { veredictos: Array(20).fill(reprovado('sempre falha')), consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 3)
  expect(roteiro.consertos, 'devia ter parado na primeira repeticao, nao no teto').toBe(1)
  expect(r.tentativas).toBe(1)
  expect(r.semProgresso).toBe(true)
  expect(r.veredicto.status).toBe('falhou')
  expect(r.relato.at(-1), 'o relato precisa dizer POR QUE parou, senao parece que esgotou o teto').toContain('MESMA reprovacao')
})

test('repeticao so conta depois de um conserto — diferenca de caixa ou espaco nao vale como progresso', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('Typecheck:  3   erros'), reprovado('typecheck: 3 erros')], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 3)
  expect(r.semProgresso, 'a mesma frase com outra caixa e outro espacamento nao e progresso').toBe(true)
  expect(roteiro.consertos).toBe(1)
})

test('esgotado o teto, o relato diz o que JA foi tentado — nao so que falhou', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('erro A'), reprovado('erro B'), reprovado('erro C')], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 2)
  expect(r.relato).toHaveLength(2)
  expect(r.relato[0]).toContain('erro A')
  expect(r.relato[1]).toContain('erro B')
  const texto = relatoParaHumano(r)
  expect(texto).toContain('ja tentado (2)')
  expect(texto).toContain('erro A')
})

test('REGRESSAO inconclusivo NAO dispara reparo — nao se conserta o que nao foi diagnosticado', async () => {
  const roteiro: Roteiro = { veredictos: [inconclusivo('o gate nao executou')], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 3)
  expect(roteiro.consertos, 'tentar consertar sem diagnostico e adivinhacao cara').toBe(0)
  expect(r.veredicto.status).toBe('inconclusivo')
  expect(r.tentativas).toBe(0)
})

test('cada tentativa fica no diario do card, com a fase e o motivo', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('lint quebrado'), APROVADO], consertos: 0 }
  await repararAteOTeto(gateQueSegue(roteiro, 'seguranca'), 2, 'card-9')
  const tentativas = eventosDoCard('card-9').filter(e => e.evento === 'repair_attempt')
  expect(tentativas).toHaveLength(1)
  expect(tentativas[0]?.fase).toBe('seguranca')
  expect(tentativas[0]?.detalhe).toContain('lint quebrado')
  expect(tentativas[0]?.detalhe).toContain('1/2')
})

test('sem card, o loop funciona igual e nao tenta escrever diario', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('x'), APROVADO], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 1)
  expect(r.veredicto.status).toBe('ok')
})

test('teto zero desliga o reparo, mas o gate ainda roda uma vez', async () => {
  const roteiro: Roteiro = { veredictos: [reprovado('falhou')], consertos: 0 }
  const r = await repararAteOTeto(gateQueSegue(roteiro), 0)
  expect(roteiro.consertos).toBe(0)
  expect(r.veredicto.status).toBe('falhou')
})

test('a varredura de teto enxerga lacos de verdade — senao o invariante passaria vazio', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const arquivos: string[] = []
  const anda = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) anda(p)
      else if (p.endsWith('.ts')) arquivos.push(p)
    }
  }
  anda('motor')
  const comLaco = arquivos.filter(a => /\bwhile\s*\(/.test(readFileSync(a, 'utf8')))
  expect(comLaco.length, 'a varredura nao achou while nenhum em motor/ — regex ou raiz quebrou').toBeGreaterThan(3)
})

test('INVARIANTE nenhum loop de reparo no motor roda sem teto', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const arquivos: string[] = []
  const anda = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) anda(p)
      else if (p.endsWith('.ts')) arquivos.push(p)
    }
  }
  anda('motor')

  const semTeto: string[] = []
  for (const a of arquivos) {
    const linhas = readFileSync(a, 'utf8').split('\n')
    linhas.forEach((l, i) => {
      // while que reexecuta algo enquanto falha, sem comparar com um limite
      if (!/\bwhile\s*\(/.test(l)) return
      if (/reajuste|attempt|tentativa/i.test(l) && !/<|<=|maxReajuste|teto/.test(l)) {
        semTeto.push(`${a}:${i + 1}  ${l.trim()}`)
      }
    })
  }
  expect(semTeto, 'repair loop sem teto e o modo de falha que este motor nao aceita').toEqual([])
})

import { test, expect } from '../apoio/runner.ts'
import {
  promptDoRamo, montarRamos, despacharDivergencia, orcamentoDaDivergencia,
  parsePropostas, enquadramentosParaCard,
} from '../../motor/cic/mcn/divergir.ts'
import type { Ramo, SaidaDeRamo } from '../../motor/cic/mcn/divergir.ts'
import { lerEnquadramentos } from '../../motor/cic/mcn/enquadramentos.ts'

const FONTE = lerEnquadramentos()
const QUATRO = FONTE.enquadramentos.slice(0, 4)
const ENUNCIADO = 'como estruturar o cache de sessao entre os nos'

function despachanteQueGrava(recebidos: Ramo[]): (r: Ramo) => Promise<SaidaDeRamo> {
  return async (r: Ramo) => {
    recebidos.push(r)
    // Marcador unico por ramo. Se qualquer prompt contiver o marcador de outro
    // ramo, o isolamento vazou.
    return { enquadramento: r.enquadramento, ok: true, texto: `{"propostas":["MARCADOR-${r.enquadramento}"]}`, custoUsd: 0.01 }
  }
}

test('ISOLAMENTO o prompt de um ramo nao cita nenhum outro enquadramento', () => {
  const ramos = montarRamos(ENUNCIADO, QUATRO)
  expect(ramos).toHaveLength(4)
  for (const ramo of ramos) {
    const eu = QUATRO.find(e => e.id === ramo.enquadramento)
    expect(eu).toBeDefined()
    for (const outro of QUATRO) {
      if (outro.id === ramo.enquadramento) continue
      expect(ramo.prompt, `ramo "${ramo.enquadramento}" cita o id de "${outro.id}"`).not.toContain(outro.id)
      expect(ramo.prompt, `ramo "${ramo.enquadramento}" cita o nome de "${outro.id}"`).not.toContain(outro.nome)
      expect(ramo.prompt, `ramo "${ramo.enquadramento}" cita a lente de "${outro.id}"`).not.toContain(outro.lente)
    }
  }
})

test('ISOLAMENTO nenhuma saida de ramo entra no prompt de outro ramo', async () => {
  const recebidos: Ramo[] = []
  const d = await despacharDivergencia(ENUNCIADO, QUATRO, despachanteQueGrava(recebidos))
  expect(recebidos).toHaveLength(4)
  // Todo ramo devolveu um MARCADOR. Se o despacho fosse sequencial com
  // acumulacao de contexto, algum prompt teria o marcador de um anterior.
  for (const r of recebidos) {
    expect(r.prompt, `o prompt de "${r.enquadramento}" carrega a saida de outro ramo`).not.toContain('MARCADOR-')
  }
  expect(d.propostas).toHaveLength(4)
  expect(new Set(d.propostas.map(p => p.enquadramento)).size).toBe(4)
})

test('ISOLAMENTO promptDoRamo nao tem como ver a lista — recebe UM enquadramento', () => {
  const so = QUATRO[0]
  expect(so).toBeDefined()
  if (!so) return
  const p = promptDoRamo(so, ENUNCIADO)
  expect(p).toContain(so.nome)
  expect(p).toContain(ENUNCIADO)
  // A funcao e pura sobre um enquadramento: o mesmo par sempre da o mesmo texto.
  expect(promptDoRamo(so, ENUNCIADO)).toBe(p)
})

test('o critico e outro agente — o ramo e proibido de avaliar e a instrucao esta no prompt', () => {
  const so = QUATRO[0]
  if (!so) return
  const p = promptDoRamo(so, ENUNCIADO)
  expect(p).toContain('NAO avalie')
  expect(p).toContain('outro agente faz isso')
})

test('TETO divergencia com menos de 2 ramos LANCA', () => {
  expect(() => orcamentoDaDivergencia(1, 0)).toThrow('nao e divergencia')
})

test('TETO card que ja consumiu o orcamento nao abre ramo nenhum', () => {
  const teto = orcamentoDaDivergencia(4, 0).tetoUsd
  expect(() => orcamentoDaDivergencia(4, teto)).toThrow('estouraria o orcamento')
})

// `expect(o.porRamoUsd).toBeCloseTo(o.restanteUsd / 4)` repetia a formula do
// codigo: trocar a divisao por multiplicacao nos dois lados mantinha o teste
// verde. As assercoes abaixo usam NUMEROS, que so fecham se a conta estiver certa.
test('TETO o restante e dividido pelos ramos — N ramos multiplicam o custo por N', () => {
  const governanca = { versao: 1, padrao: 'tier2_padrao' as const, criterios: {}, orcamentoPorCard: { tetoUsd: 16, acaoAoEstourar: 'pausar' } }
  const o = orcamentoDaDivergencia(4, 4, governanca)
  expect(o.tetoUsd).toBe(16)
  expect(o.restanteUsd).toBe(12)
  expect(o.porRamoUsd).toBe(3)
  expect(orcamentoDaDivergencia(8, 4, governanca).porRamoUsd).toBe(1.5)
  expect(orcamentoDaDivergencia(2, 0, governanca).porRamoUsd).toBe(8)
})

test('TETO POR RAMO chega ao ramo — numero calculado e nao aplicado nao e teto', async () => {
  const { montarRamos, despacharDivergencia, relatoDeEstouro } = await import('../../motor/cic/mcn/divergir.ts')
  const ramos = montarRamos('resolver x', QUATRO, 2, 3)
  expect(ramos.map(r => r.tetoUsd), 'o despachante nao pode ficar sem saber quanto pode gastar').toEqual([3, 3, 3, 3])

  const vistos: number[] = []
  const d = await despacharDivergencia('resolver x', QUATRO, async (r) => {
    vistos.push(r.tetoUsd)
    // O primeiro ramo estoura; os outros ficam abaixo.
    const custo = vistos.length === 1 ? r.tetoUsd * 2 : r.tetoUsd / 2
    return { enquadramento: r.enquadramento, ok: true, texto: '{"propostas":["p"]}', custoUsd: custo }
  })
  expect(vistos.every(t => t > 0), 'teto zero no ramo e o mesmo que nao ter teto').toBe(true)
  expect(d.estouraram.length, 'exatamente um ramo passou do proprio teto').toBe(1)
  // `toContain(x ?? '')` com lista vazia vira `toContain('')`, que nunca falha.
  const primeiro = d.estouraram[0]
  expect(primeiro, 'sem estouro nao ha relato a conferir').toBeDefined()
  expect(relatoDeEstouro(d.estouraram)).toContain(primeiro?.enquadramento ?? 'IMPOSSIVEL')
  expect(relatoDeEstouro([]), 'sem estouro o relato e vazio, nao uma frase sem itens').toBe('')
})

test('sem teto por ramo, ninguem e acusado de estourar — zero significa "nao ha teto", nao "teto zero"', async () => {
  const { ramosQueEstouraram } = await import('../../motor/cic/mcn/divergir.ts')
  const saidas = [{ enquadramento: 'a', ok: true, texto: '', custoUsd: 99 }]
  expect(ramosQueEstouraram(saidas, 0)).toEqual([])
  expect(ramosQueEstouraram(saidas, 98).length).toBe(1)
})

test('divergencia sem enunciado LANCA — N lentes sobre nada dao N respostas sobre nada', () => {
  expect(() => montarRamos('   ', QUATRO)).toThrow('sem enunciado')
})

test('proposta ilegivel vira lista vazia, nunca proposta inventada', () => {
  expect(parsePropostas('resposta em prosa, sem json', 'inversao')).toEqual([])
  expect(parsePropostas('{"propostas": "nao e array"}', 'inversao')).toEqual([])
  expect(parsePropostas('{"propostas":["  ", ""]}', 'inversao')).toEqual([])
})

test('ramo que falhou nao contribui proposta — falha nao vira ideia', async () => {
  const d = await despacharDivergencia(ENUNCIADO, QUATRO, async (r: Ramo) => ({
    enquadramento: r.enquadramento,
    ok: r.enquadramento !== QUATRO[0]?.id,
    texto: '{"propostas":["ok"]}',
    custoUsd: 0.01,
  }))
  expect(d.propostas).toHaveLength(3)
  expect(d.ramos).toHaveLength(4)
  expect(d.custoUsd).toBeCloseTo(0.04, 10)
})

test('a escolha de enquadramento e DETERMINISTICA — mesma semente, mesmos ramos', () => {
  const a = enquadramentosParaCard('card-42').map(e => e.id)
  const b = enquadramentosParaCard('card-42').map(e => e.id)
  expect(a).toEqual(b)
  const outro = enquadramentosParaCard('card-99').map(e => e.id)
  expect(a.length).toBe(outro.length)
})

import { test, expect } from '../apoio/runner.ts'
import { dificuldadeDaEtapa, escolherEtapa, validarPoliticaDeEtapa } from '../../motor/tomada/etapa.ts'
import type { PoliticaDeEtapa } from '../../motor/tomada/etapa.ts'
import type { CandidatoDeRota, ConsultaDeRota } from '../../motor/tomada/rota.ts'

const candidato = (nome: string, extras: Partial<CandidatoDeRota> = {}): CandidatoDeRota => ({
  nome, agentic: true, isolaLeitura: true, rodaLocal: false, autenticado: true, cotaEsgotada: false,
  emitsStructuredJson: true, supportsVision: true, mcp: true, ...extras,
})
function consulta(candidatos: CandidatoDeRota[]): ConsultaDeRota {
  return { candidatosDoPapel: () => candidatos.map(c => c.nome), candidato: nome => candidatos.find(c => c.nome === nome) }
}
const politica: PoliticaDeEtapa = { versao: 1, rotas: [
  { papel: 'implement', dificuldade: 'padrao', provedores: ['barato', 'capaz'] },
  { papel: 'verify', dificuldade: 'padrao', provedores: ['barato', 'capaz'] },
] }

test('roteador seleciona antes da execucao em ordem explicita, sem fingir medicao de custo', () => {
  expect(escolherEtapa('implement', 'padrao', politica, consulta([candidato('barato'), candidato('capaz')]))?.provedor).toBe('barato')
  expect(escolherEtapa('implement', 'complexa', politica, consulta([candidato('capaz')]))).toBe(null)
})

test('cota, login, escrita, visao e MCP sao requisitos, nao bonus de pontuacao', () => {
  for (const restricao of [{ autenticado: false }, { cotaEsgotada: true }, { agentic: false }, { supportsVision: false }, { mcp: false }]) {
    expect(escolherEtapa('implement', 'padrao', politica, consulta([candidato('barato', restricao), candidato('capaz')]), { visual: true, mcp: true })?.provedor).toBe('capaz')
  }
})

test('review exige isolamento de leitura e JSON e localidade nunca permite nuvem', () => {
  expect(escolherEtapa('verify', 'padrao', politica, consulta([candidato('barato', { isolaLeitura: false }), candidato('capaz')]))?.provedor).toBe('capaz')
  expect(escolherEtapa('verify', 'padrao', politica, consulta([candidato('barato', { emitsStructuredJson: false })]))).toBe(null)
  expect(escolherEtapa('implement', 'padrao', politica, consulta([candidato('barato'), candidato('capaz', { rodaLocal: true, inferenciaLocalVerificada: false })]), { somenteLocal: true })).toBe(null)
})

test('risco, seguranca e reparo elevam dificuldade mesmo quando o titulo sugere documentacao', () => {
  const card = { file: '', order: [], fm: { title: 'README' }, body: 'Corrigir documentacao' }
  expect(dificuldadeDaEtapa(card)).toBe('simples')
  expect(dificuldadeDaEtapa({ ...card, fm: { ...card.fm, risk: 'high' } })).toBe('complexa')
  expect(dificuldadeDaEtapa(card, 'teste falhou')).toBe('complexa')
  expect(dificuldadeDaEtapa({ ...card, body: 'documentacao do pagamento' })).toBe('complexa')
})

test('politica invalida e ambiguidades recusam configuracao antes do despacho', () => {
  expect(() => validarPoliticaDeEtapa({ ...politica, rotas: [...politica.rotas, politica.rotas[0]!] })).toThrow('duplicada')
  expect(() => validarPoliticaDeEtapa({ versao: 1, rotas: [{ papel: 'implement', dificuldade: 'padrao', provedores: [] }] })).toThrow('invalida')
})

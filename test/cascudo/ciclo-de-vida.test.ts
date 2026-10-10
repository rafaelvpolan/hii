import { test, expect } from '../apoio/runner.ts'
import { lerSkill, skillsPara } from '../../motor/cascudo/acervo.ts'

const texto = (id: string, estado = '') => `---\nid: ${id}\npapeis: [implementador]\nsempre: true\n${estado ? `estado: ${estado}\n` : ''}---\nVerifique requisitos antes da entrega.`
const skill = (id: string, estado = '') => lerSkill(texto(id, estado), `${id}/SKILL.md`, 'common', '_native')

test('skills antigas continuam estaveis; trial requer opt-in e retired nunca carrega', () => {
  const acervo = [skill('antiga'), skill('ativa', 'active'), skill('candidata', 'trial'), skill('aposentada', 'retired')]
  expect(acervo[0]?.estado).toBe('stable')
  expect(skillsPara('implementador', { arquivos: [], deps: [] }, acervo).map(s => s.id)).toEqual(['antiga', 'ativa'])
  expect(skillsPara('implementador', { arquivos: [], deps: [], experimentarSkills: true }, acervo).map(s => s.id)).toEqual(['antiga', 'ativa', 'candidata'])
})

test('ids conflitantes e estados invalidos recusam carga de instrucoes', () => {
  expect(() => skillsPara('implementador', { arquivos: [], deps: [] }, [skill('x'), skill('x')])).toThrow('duplicado')
  expect(() => skill('x', 'inventado')).toThrow('invalido')
})

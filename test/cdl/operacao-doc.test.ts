import { test, expect } from '../apoio/runner.ts'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COMMANDS, ALIASES } from '../../motor/mir/sessao.ts'
import { NOMES_DE_COMANDO_MANUAL } from '../../motor/mir/comandos-manuais.ts'

// OPERACAO.md e manual de EXECUCAO: o leitor cola o comando. Documentacao com
// comando que nao existe e pior que documentacao ausente — a ausente manda ler o
// codigo, a errada manda para um beco. Estes invariantes nao provam que o texto
// esta certo; provam que os NOMES citados existem, que e o que envelhece sozinho.

const DOC = readFileSync('OPERACAO.md', 'utf8')

function arquivosTs(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) { saida.push(...arquivosTs(p)); continue }
    if (p.endsWith('.ts')) saida.push(p)
  }
  return saida
}

test('a varredura enxerga o documento — senao os invariantes passam vazios', () => {
  expect(DOC.length, 'OPERACAO.md vazio ou nao encontrado').toBeGreaterThan(5000)
})

test('todo comando de TUI citado em OPERACAO.md existe', () => {
  const conhecidos = new Set<string>([
    ...COMMANDS,
    ...NOMES_DE_COMANDO_MANUAL,
    ...Object.keys(ALIASES),
    ...Object.values(ALIASES).flat(),
  ])
  const citados = [...new Set([...DOC.matchAll(/(?<![\w/])(\/[a-z][a-z-]{2,})/g)].map(m => m[1] ?? ''))]
  expect(citados.length, 'o documento tem de citar comandos').toBeGreaterThan(5)
  const inexistentes = citados.filter(c => !conhecidos.has(c))
  expect(inexistentes, 'comando de TUI citado no manual e ausente do motor').toEqual([])
})

test('toda variavel HICODE_ citada em OPERACAO.md existe no codigo', () => {
  const noCodigo = new Set<string>()
  for (const f of [...arquivosTs('motor'), ...arquivosTs('bin'), 'runner.ts']) {
    for (const m of readFileSync(f, 'utf8').matchAll(/HICODE_[A-Z_]+/g)) noCodigo.add(m[0])
  }
  const citadas = [...new Set([...DOC.matchAll(/HICODE_[A-Z_]+/g)].map(m => m[0]))]
  expect(citadas.length).toBeGreaterThan(15)
  expect(citadas.filter(v => !noCodigo.has(v)), 'variavel citada no manual e ausente do codigo').toEqual([])
})

test('todo agente citado como executor existe no menu do implement ou nos passos', async () => {
  const { AGENTES_IMPLEMENT, AGENTE_PADRAO } = await import('../../motor/cic/agente.ts')
  const { DEFAULT_STEPS } = await import('../../motor/nmy/config.ts')
  const conhecidos = new Set([...AGENTES_IMPLEMENT, AGENTE_PADRAO, ...DEFAULT_STEPS.map(s => s.agent), 'crivo'])
  // So a tabela de agentes: prosa solta citaria nome em outro contexto.
  const tabela = DOC.slice(DOC.indexOf('## 6. Agentes'), DOC.indexOf('## 7.'))
  const citados = [...new Set([...tabela.matchAll(/`(vitro|frontiteto|limpio|radix|rufus|testudo|escudo|pura|crivo)`/g)].map(m => m[1] ?? ''))]
  expect(citados.length, 'a secao de agentes tem de citar agentes').toBeGreaterThan(4)
  expect(citados.filter(a => !conhecidos.has(a)), 'agente citado no manual e desconhecido do motor').toEqual([])
})

test('todo pack citado existe em skills/_native', () => {
  const reais = new Set(readdirSync('skills/_native'))
  const secao = DOC.slice(DOC.indexOf('## 7. Skills e packs'), DOC.indexOf('## 8.'))
  const citados = [...new Set([...secao.matchAll(/`(common|frontend-web|backend-web|mobile|devops-deploy|games-multiplatform)`/g)].map(m => m[1] ?? ''))]
  expect(citados.length).toBeGreaterThan(3)
  expect(citados.filter(p => !reais.has(p)), 'pack citado no manual nao existe em skills/_native').toEqual([])
})

test('todo estado citado no grafo existe em config/topologia.json', () => {
  const topo = JSON.parse(readFileSync('config/topologia.json', 'utf8')) as { nos: string[] }
  const nos = new Set(topo.nos)
  const secao = DOC.slice(DOC.indexOf('## 4. O grafo de estados'), DOC.indexOf('## 5.'))
  const citados = [...new Set([...secao.matchAll(/\b([A-Z][A-Z_]{3,})\b/g)].map(m => m[1] ?? ''))]
  expect(citados.length, 'a secao do grafo tem de citar estados').toBeGreaterThan(8)
  expect(citados.filter(e => !nos.has(e)), 'estado citado no grafo do manual nao existe na topologia').toEqual([])
})

// O manual afirma que os exemplos da tabela de perfis sao MEDIDOS, e nao
// ilustrativos. Este teste e o que torna a afirmacao verdadeira: ele passa os mesmos
// enunciados pelo classificador. Casar o TEXTO acentuado do documento seria fragil e
// nao provaria nada — o que precisa continuar valendo e a classificacao.
test('os exemplos da tabela de perfis sao medidos, e continuam medindo o mesmo', async () => {
  const { planSteps } = await import('../../motor/osw/rta/perfil.ts')
  const { DEFAULT_STEPS } = await import('../../motor/nmy/config.ts')
  for (const [enunciado, perfil] of [
    ['trocar a cor do botao', 'visual'],
    ['calculo de comissao do plano anual', 'padrao'],
    ['bump da dependencia lodash', 'deps'],
    ['corrigir o typo do readme', 'enxuto'],
  ] as const) {
    expect(planSteps({ title: enunciado, objetivo: enunciado, risk: 'low' }, DEFAULT_STEPS).profile, enunciado).toBe(perfil)
  }
})

test('a tabela de perfis do manual lista os seis perfis que existem', async () => {
  const secao = DOC.slice(DOC.indexOf('### Perfis'), DOC.indexOf('## 6.'))
  for (const perfil of ['completo', 'padrao', 'deps', 'enxuto', 'visual', 'externo']) {
    expect(secao, `perfil "${perfil}" fora da tabela`).toContain(`\`${perfil}\``)
  }
})

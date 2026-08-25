import { test, expect, beforeEach, afterEach, lerArquivo } from '../apoio/runner.ts'
import { readFileSync } from 'node:fs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMANDOS_MANUAIS, NOMES_DE_COMANDO_MANUAL, comandoManual, interpretarIntake,
  camposDoIntake, packsDoCard, packsAusentes, validarComandosManuais,
} from '../../motor/mir/comandos-manuais.ts'
import { COMMANDS, handle, newSession } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { carregarAcervo, skillsPara } from '../../motor/csd/acervo.ts'
import { allCards, readCard } from '../../motor/cdl/store.ts'

// MIR — item 16. A regra que define estes comandos: eles pre-carregam CONTEUDO
// diferente e rodam O MESMO pipeline. Atalho com caminho de execucao proprio
// seria um segundo motor, com gates proprios — e os gates do primeiro deixariam
// de valer para metade do trabalho.

let dir = ''
let saida: string[] = []
const io = dispatchIOFalso({ log: (l: string) => { saida.push(l) } })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-intake-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  saida = []
})
afterEach(() => { delete process.env.HICODE_CARDS_DIR })

test('INVARIANTE todo pack citado por um comando manual EXISTE no acervo', () => {
  // Esta e a guarda que manteve o item 16 adiado por tres ondas: atalho que
  // pre-carrega vazio parece que carregou alguma coisa.
  expect(packsAusentes()).toEqual([])
  expect(() => validarComandosManuais()).not.toThrow()
})

test('INVARIANTE a guarda de pack ausente REPROVA de verdade', () => {
  const acervoSemMobile = carregarAcervo().filter(s => s.pack !== 'mobile')
  expect(() => validarComandosManuais(acervoSemMobile)).toThrow('pack que nao existe')
  expect(packsAusentes(acervoSemMobile).map(a => a.pack)).toContain('mobile')
})

test('INVARIANTE o atalho NAO cria caminho de execucao paralelo', () => {
  const fonte = readFileSync('motor/mir/despacho.ts', 'utf8')
  // core.submit mora num lugar so. Duas chamadas significam que o atalho ganhou
  // criacao propria, e a partir dai os dois caminhos divergem em silencio.
  const chamadas = fonte.match(/core\.submit\(/g) ?? []
  expect(chamadas.length, 'submit livre e atalho de intake tem de passar pela MESMA criacao de card').toBe(1)
  // approvePlan tem dois usos legitimos: a criacao (aqui) e o /approve
  // explicito do humano. O que nao pode duplicar e a CRIACAO.
})

test('os comandos manuais estao em COMMANDS — senao o autocompletar nao os oferece', () => {
  for (const nome of NOMES_DE_COMANDO_MANUAL) {
    expect([nome, (COMMANDS as readonly string[]).includes(nome)]).toEqual([nome, true])
  }
})

test('todo comando manual tem descricao e ao menos um pack', () => {
  for (const c of COMANDOS_MANUAIS) {
    expect([c.nome, c.packs.length > 0]).toEqual([c.nome, true])
    expect([c.nome, c.descricao.length > 15]).toEqual([c.nome, true])
    // common entra em todos: o basico nao depende de dominio.
    expect([c.nome, c.packs.includes('common')]).toEqual([c.nome, true])
  }
})

test('interpretarIntake separa comando de texto, e ignora o que nao e atalho', () => {
  const i = interpretarIntake('/orquestrador-devops migrar o deploy para swarm')
  expect(i?.comando).toBe('/orquestrador-devops')
  expect(i?.texto).toBe('migrar o deploy para swarm')
  expect(i?.packs).toEqual(['common', 'devops-deploy'])
  expect(interpretarIntake('/help')).toBeNull()
  expect(interpretarIntake('texto livre')).toBeNull()
  expect(interpretarIntake('/nao-existe')).toBeNull()
})

test('/layout liga o modo de layout no card, e os outros nao', () => {
  expect(camposDoIntake(interpretarIntake('/layout ajustar o painel')!).layout).toBe('on')
  expect(camposDoIntake(interpretarIntake('/orquestrador-jogos novo jogo')!).layout).toBeUndefined()
})

test('atalho sem texto explica o uso em vez de criar card vazio', async () => {
  for (const nome of NOMES_DE_COMANDO_MANUAL) {
    const r = handle(nome, newSession('org/app'))
    expect([nome, r.effect.kind]).toEqual([nome, 'error'])
    expect([nome, (r.effect.text ?? '').includes('uso:')]).toEqual([nome, true])
  }
  expect(allCards().length, 'nenhum card pode ter sido criado').toBe(0)
})

test('o atalho cria card pelo caminho normal, com os packs gravados', async () => {
  const r = handle('/orquestrador-android tela de login', newSession('org/app'))
  expect(r.effect.kind).toBe('intake')
  expect(r.effect.raw).toBe('/orquestrador-android')
  await dispatch(r.effect, r.state, io)
  const cards = allCards()
  expect(cards.length).toBe(1)
  const c = readCard(cards[0]?.id ?? '')
  expect(c?.fm.packs).toBe('common,mobile')
  expect(saida.join(' ')).toContain('common, mobile')
})

test('MESMO PIPELINE o card do atalho e indistinguivel do card de /new-task, menos o conteudo', async () => {
  const viaAtalho = handle('/orquestrador-android tela de login', newSession('org/app'))
  await dispatch(viaAtalho.effect, viaAtalho.state, io)
  const a = readCard(allCards()[0]?.id ?? '')

  // Mesmo texto, pelo caminho livre.
  const viaSubmit = handle('/new-task tela de login', newSession('org/app'))
  await dispatch(viaSubmit.effect, viaSubmit.state, io)
  const b = readCard(allCards().find(c => c.id !== a?.fm.id)?.id ?? '')

  expect(a).toBeTruthy()
  expect(b).toBeTruthy()
  // Tudo que nao e identidade nem conteudo pre-carregado tem de bater. Se o
  // atalho tivesse caminho proprio, algum destes divergiria.
  for (const campo of ['status', 'risk', 'repo', 'title']) {
    expect([campo, a?.fm[campo]]).toEqual([campo, b?.fm[campo]])
  }
  // E a UNICA diferenca e o conhecimento declarado.
  expect(a?.fm.packs).toBe('common,mobile')
  expect(b?.fm.packs).toBeUndefined()
})

test('/layout grava layout: on no card, pelo mesmo caminho', async () => {
  const r = handle('/layout revisar o espacamento do board', newSession('org/app'))
  await dispatch(r.effect, r.state, io)
  const c = readCard(allCards()[0]?.id ?? '')
  expect(c?.fm.layout).toBe('on')
  expect(c?.fm.packs).toBe('common,frontend-web')
})

test('sem projeto o atalho recusa igual ao submit — a parede e a mesma', async () => {
  const r = handle('/orquestrador-devops subir o stack', newSession(''))
  await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(0)
  expect(saida.join(' ')).toContain('sem projeto')
})

test('packsDoCard le o campo de volta, e campo ausente devolve lista vazia', () => {
  expect(packsDoCard('common,mobile')).toEqual(['common', 'mobile'])
  expect(packsDoCard(' common , mobile ')).toEqual(['common', 'mobile'])
  expect(packsDoCard(undefined)).toEqual([])
  expect(packsDoCard('')).toEqual([])
})

test('O PROBLEMA QUE O ITEM RESOLVE: greenfield sem arquivo nao carrega dominio', () => {
  // Sem arquivo tocado e sem dependencia detectada — que e exatamente o card de
  // projeto novo — o gatilho so alcanca as skills `sempre: true`.
  const semNada = skillsPara('implementador', { arquivos: [], deps: [] })
  expect(semNada.every(s => s.pack === 'common'), 'greenfield so alcanca common pelo gatilho').toBe(true)

  // Com o pack declarado pelo atalho, o dominio entra.
  const comPack = skillsPara('implementador', { arquivos: [], deps: [], packs: ['common', 'mobile'] })
  expect(comPack.some(s => s.pack === 'mobile')).toBe(true)
  expect(comPack.length).toBeGreaterThan(semNada.length)
})

test('pack declarado ENTRA ALEM do gatilho, nunca no lugar dele', () => {
  const ctx = { arquivos: ['app/components/Botao.vue'], deps: ['vue'], packs: ['devops-deploy'] }
  const skills = skillsPara('implementador', ctx)
  const packs = new Set(skills.map(s => s.pack))
  expect(packs.has('frontend-web'), 'o gatilho por arquivo continua valendo').toBe(true)
  expect(packs.has('devops-deploy'), 'o pack declarado tambem entra').toBe(true)
})

test('/orquestrador-dev-web carrega front E back — o unico atalho com dois dominios', () => {
  const c = comandoManual('/orquestrador-dev-web')
  expect(c?.packs).toEqual(['common', 'frontend-web', 'backend-web'])
  const i = interpretarIntake('/orquestrador-dev-web api de pedidos com tela de acompanhamento')
  expect(i?.packs).toContain('backend-web')
  expect(i?.packs).toContain('frontend-web')
  const skills = skillsPara('implementador', { arquivos: [], deps: [], packs: i?.packs ?? [] })
  const packs = new Set(skills.map(s => s.pack))
  expect(packs.has('frontend-web')).toBe(true)
  expect(packs.has('backend-web')).toBe(true)
})

test('comandoManual devolve undefined para nome que nao e atalho', () => {
  expect(comandoManual('/help')).toBeUndefined()
  expect(comandoManual('')).toBeUndefined()
})

// O comentario da funcao afirmava "chamada no arranque e no teste" e SO o teste
// chamava. Guarda contra a afirmacao voltar a ser falsa.
test('INVARIANTE o arranque do daemon chama validarComandosManuais de verdade', async () => {
  const fonte = await lerArquivo('runner.ts')
  expect(fonte).toContain("from './motor/mir/comandos-manuais.ts'")
  const iChamada = fonte.indexOf('validarComandosManuais()')
  expect(iChamada, 'a chamada nao esta no runner: o comentario da funcao volta a mentir').toBeGreaterThan(-1)
  // E converte o lance em aviso: um atalho quebrado nao pode tirar o motor do ar.
  const trecho = fonte.slice(Math.max(0, iChamada - 200), iChamada + 200)
  expect(trecho, 'sem try/catch, acervo incompleto derruba o daemon').toContain('catch')
})

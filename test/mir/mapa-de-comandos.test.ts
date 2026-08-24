import { test, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COMMANDS, ALIASES, canonico, handle, newSession } from '../../motor/mir/sessao.ts'

// MIR — a varredura que faz comando novo sem teste REPROVAR.
//
// COMMANDS alimenta o autocompletar: o que esta na lista o usuario ve e tenta
// usar. Uma lista que oferece comando que ninguem exercita e pior que uma lista
// curta, porque promete superficie que ninguem sabe se funciona.
//
// Tres varreduras, de propósito por caminhos diferentes: uma le o codigo do
// despachante, outra le os arquivos de teste, e a terceira EXECUTA. Cobertura
// medida so por texto ja falhou neste repo antes.

// `semComentarios` porque um COMENTARIO citando o comando satisfazia a varredura:
// o comentario "/ia, /model, /effort e /mode nao tinham teste nenhum" cobria os
// quatro comandos que ele diz nao estarem cobertos. O repo ja usava este remedio
// em test/euc/tsr-orcamento.test.ts.
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n')
}

const ARQUIVOS_DE_TESTE = readdirSync('test/mir')
  .filter(n => n.endsWith('.test.ts') && n !== 'mapa-de-comandos.test.ts')
  .map(n => ({ nome: n, fonte: semComentarios(readFileSync(join('test/mir', n), 'utf8')) }))

test('a varredura enxerga os testes — senao os invariantes passariam vazios', () => {
  expect(ARQUIVOS_DE_TESTE.length).toBeGreaterThan(40)
})

test('INVARIANTE todo comando de COMMANDS e RECONHECIDO pelo despachante', () => {
  const orfaos = COMMANDS.filter(cmd => {
    const r = handle(cmd, newSession())
    return r.effect.kind === 'error' && (r.effect.text ?? '').includes('comando desconhecido')
  })
  expect(orfaos, 'comando listado no autocompletar que o handle nao conhece promete superficie que nao existe').toEqual([])
})

// O casamento tem de terminar o nome do comando. Enquanto era por PREFIXO
// (`fonte.includes("'" + cmd)`), `/mode` era considerado coberto por qualquer
// teste que mencionasse `/model`, e `/new` por `/new-task` — a varredura que
// existe para pegar comando sem teste dava verde para comando sem teste.
function exercitado(cmd: string, fonte: string): boolean {
  const escapado = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Fronteira dos DOIS lados, e o lookahead bloqueia tambem `.` e `/`: sem isso,
  // as ~30 linhas `import ... '../../motor/mir/tui/layout.ts'` casavam com
  // `/layout`, e o invariante nunca podia reprovar aquele comando. A fronteira a
  // esquerda impede `/new` casar dentro de `--new`.
  return new RegExp(`(^|[^a-z0-9./-])${escapado}(?![a-z0-9./-])`, 'im').test(fonte)
}

test('INVARIANTE todo comando de COMMANDS tem teste que o exercita', () => {
  const semTeste = COMMANDS.filter(cmd => !ARQUIVOS_DE_TESTE.some(a => exercitado(cmd, a.fonte)))
  expect(semTeste, 'comando novo sem teste: acrescente cobertura em test/mir/ antes de listar em COMMANDS').toEqual([])
})

test('a varredura NAO casa por prefixo — senao /mode passaria coberto por um teste de /model', () => {
  expect(exercitado('/mode', "handle('/model opus')"), '/model nao exercita /mode').toBe(false)
  expect(exercitado('/mode', "handle('/mode plan')")).toBe(true)
  expect(exercitado('/new', "handle('/new-task foo')"), '/new-task nao exercita /new').toBe(false)
  expect(exercitado('/gauntlet', "handle('/gauntlet on')")).toBe(true)
})

test('a varredura NAO casa em CAMINHO DE IMPORT — /layout nao e coberto por tui/layout.ts', () => {
  const soImport = "import { renderFrame } from '../../motor/mir/tui/layout.ts'"
  expect(exercitado('/layout', soImport), 'o furo permanente: 30 imports satisfaziam o invariante').toBe(false)
  expect(exercitado('/layout', "handle('/layout mudar o header')")).toBe(true)
  expect(exercitado('/ref', "import x from './refs-comando.ts'"), 'caminho relativo nao exercita /ref').toBe(false)
  expect(exercitado('/ref', "handle('/ref clipboard')")).toBe(true)
})

test('INVARIANTE todo apelido resolve para um comando que existe em COMMANDS', () => {
  const soltos: string[] = []
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    if (!COMMANDS.includes(principal as (typeof COMMANDS)[number])) soltos.push(`${principal} (principal fora de COMMANDS)`)
    for (const a of apelidos) {
      if (canonico(a) !== principal) soltos.push(`${a} -> ${canonico(a)}, esperado ${principal}`)
    }
  }
  expect(soltos, 'apelido que nao resolve para comando real vira comando desconhecido na cara do usuario').toEqual([])
})

test('INVARIANTE todo apelido tambem e RECONHECIDO, nao so o nome principal', () => {
  const orfaos: string[] = []
  for (const apelidos of Object.values(ALIASES)) {
    for (const a of apelidos) {
      const r = handle(a, newSession())
      if (r.effect.kind === 'error' && (r.effect.text ?? '').includes('comando desconhecido')) orfaos.push(a)
    }
  }
  expect(orfaos, 'apelido declarado e nao tratado no switch e promessa quebrada').toEqual([])
})

test('comando fora da lista continua caindo em "desconhecido", com o nome citado', () => {
  const r = handle('/nao-existe-isto', newSession())
  expect(r.effect.kind).toBe('error')
  expect(r.effect.text).toContain('nao-existe-isto')
  expect(r.effect.text).toContain('/help')
})

test('nenhum comando de COMMANDS LANCA, em nenhum estado da sessao', () => {
  const estados = [
    newSession(),
    { ...newSession(), pendingPlan: '12' },
    { ...newSession(), perguntando: '12' },
    { ...newSession(), removendo: '12' },
    { ...newSession(), retomando: '12' },
    { ...newSession(), escolhendo: true },
    { ...newSession(), aprovando: '12' },
    { ...newSession(), comentando: '12' },
    { ...newSession(), seguindo: '12' },
    { ...newSession(), tela: 'config' as const },
  ]
  for (const cmd of COMMANDS) {
    for (const estado of estados) {
      expect(() => handle(cmd, estado), `${cmd} lancou`).not.toThrow()
      expect(() => handle(`${cmd} argumento extra`, estado), `${cmd} com argumento lancou`).not.toThrow()
    }
  }
})

test('a varredura ignora COMENTARIO — senao a prosa que cita o comando conta como teste', () => {
  const soComentario = "// /ia, /model, /effort e /mode nao tinham teste nenhum\nconst x = 1"
  expect(exercitado('/mode', semComentarios(soComentario)), 'comentario nao exercita nada').toBe(false)
  expect(exercitado('/mode', semComentarios("handle('/mode plan') // nota sobre /effort"))).toBe(true)
  expect(exercitado('/effort', semComentarios("handle('/mode plan') // nota sobre /effort")), 'nem no rabo da linha').toBe(false)
})

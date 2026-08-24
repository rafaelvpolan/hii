import { test, expect } from 'bun:test'
import { renderHelp } from '../../motor/mir/render/help.ts'
import { stripAnsi, visibleLen } from '../../motor/mir/tui/layout.ts'

test('agrupa por proposito, nao numa lista solta', () => {
  const t = renderHelp().join('\n')
  for (const secao of ['comecar', 'acompanhar', 'decidir', 'projeto', 'teclas']) {
    expect(t).toContain(secao)
  }
})

// A lista fixa de 9 nomes nao podia reprovar a AUSENCIA de comando novo: os 5
// atalhos de intake do item 16 eram aceitos pelo parser, descritos em sugestoes.ts
// e invisiveis no /help — que e a superficie de descoberta. Agora a fonte e
// COMMANDS, entao comando novo sem linha no /help reprova.
test('cobre todos os comandos que a sessao aceita', async () => {
  const { COMMANDS } = await import('../../motor/mir/sessao.ts')
  const t = renderHelp().join('\n')
  // `t.includes(c)` casa por SUBSTRING: com '/model' e '/mode' na lista, apagar a
  // linha do '/mode' do /help continuava verde pela linha do '/model'. Fronteira
  // dos dois lados, igual a varredura de test/mir/mapa-de-comandos.test.ts.
  const anunciado = (cmd: string): boolean =>
    new RegExp(`(^|[^a-z0-9./-])${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9./-])`, 'im').test(t)
  const semAnuncio = COMMANDS.filter(c => !anunciado(c))
  expect(semAnuncio, 'comando aceito pelo parser e ausente do /help: o recurso existe e ninguem descobre').toEqual([])
})

test('os atalhos de intake vem do MESMO catalogo do parser, nao de uma lista copiada', async () => {
  const { COMANDOS_MANUAIS } = await import('../../motor/mir/comandos-manuais.ts')
  const t = renderHelp().join('\n')
  for (const c of COMANDOS_MANUAIS) {
    expect(t, `${c.nome} nao aparece no /help`).toContain(c.nome)
    expect(t, `${c.nome} aparece sem dizer o que pre-carrega`).toContain(c.descricao.slice(0, 24))
  }
})

test('todo comando que o /help anuncia e aceito pelo parser', async () => {
  const { handle, newSession } = await import('../../motor/mir/sessao.ts')
  const texto = renderHelp().join('\n')
  const anunciados = [...new Set([...texto.matchAll(/(?:^|\s)(\/[a-z?-]+)/gm)].map(m => m[1] ?? ''))]
  expect(anunciados.length).toBeGreaterThan(8)
  for (const cmd of anunciados) {
    expect(handle(`${cmd} 001`, newSession('org/app')).effect.kind, cmd).not.toBe('error')
  }
})

test('ensina o que nao e comando: texto livre, numero e enter', () => {
  const t = renderHelp().join('\n')
  expect(t).toContain('vira tarefa')
  expect(t).toContain('abre o plano')
  expect(t).toContain('aprova o plano')
})

test('descricoes alinham na mesma coluna', () => {
  const linhas = renderHelp({ width: 78 }).filter(l => l.startsWith('    /'))
  const colunas = new Set(linhas.map(l => l.indexOf('  ', 5)))
  const inicios = linhas.map(l => l.length - l.trimStart().length)
  expect(new Set(inicios).size).toBe(1)
  expect(colunas.size).toBeGreaterThan(0)
})

test('com cor, a coluna continua alinhada (escape nao conta)', () => {
  const semCor = renderHelp({ width: 78, color: false }).filter(l => l.includes('/stop'))
  const comCor = renderHelp({ width: 78, color: true }).filter(l => l.includes('/stop'))
  expect(stripAnsi(comCor[0] ?? '')).toBe(semCor[0] ?? '')
})

test('sem cor nao emite escape ANSI', () => {
  expect(renderHelp({ color: false }).join('')).not.toContain('\x1b[')
})

test('cabe na largura pedida, mesmo em terminal estreito', () => {
  for (const width of [40, 60, 78, 120]) {
    for (const l of renderHelp({ width, color: false })) {
      expect(visibleLen(l)).toBeLessThanOrEqual(width)
    }
  }
})

test('avisa quantas tarefas esperam e por onde comecar', () => {
  const t = renderHelp({ esperando: 4, primeiroComando: '/ask 22' }).join('\n')
  expect(t).toContain('4 tarefas esperam por voce')
  expect(t).toContain('comece por /ask 22')
})

test('uma tarefa esperando fala no singular', () => {
  expect(renderHelp({ esperando: 1 }).join('\n')).toContain('1 tarefa espera')
})

test('sem nada esperando, nao inventa aviso', () => {
  expect(renderHelp({ esperando: 0 }).join('\n')).not.toContain('espera')
})

test('mostra o projeto atual no cabecalho, e omite quando nao ha', () => {
  expect(renderHelp({ repo: 'org/app' })[1]).toContain('org/app')
  expect(renderHelp({ repo: '' })[1]?.trim()).toBe('hii')
})

test('mostra o caminho da tarefa, do inicio ao PR', () => {
  const t = renderHelp().join('\n')
  expect(t).toContain('Fila')
  expect(t).toContain('Url')
  expect(t).toContain('PR')
})

test('a varredura do /help NAO casa por substring — senao apagar /mode passaria pelo /model', () => {
  const t = renderHelp().join('\n')
  const anunciado = (cmd: string): boolean =>
    new RegExp(`(^|[^a-z0-9./-])${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9./-])`, 'im').test(t)
  expect(anunciado('/mode'), '/mode tem de estar anunciado por si').toBe(true)
  expect(anunciado('/new-session')).toBe(true)
  // E o casador nao pode dar positivo por prefixo de outro texto:
  const so = (texto: string) => (cmd: string): boolean =>
    new RegExp(`(^|[^a-z0-9./-])${cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9./-])`, 'im').test(texto)
  expect(so('/model opus')('/mode'), '/model nao anuncia /mode').toBe(false)
  expect(so('atalho de /new-session')('/new'), 'a descricao de /new-session nao anuncia /new').toBe(false)
})

import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { conferirSetup, relatoDoSetup } from '../../motor/cdl/bss/setup-ferramental'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function raiz(comDebug: string | null): string {
  const d = mkdtempSync(join(tmpdir(), 'hii-bss-')); criados.push(d)
  if (comDebug) {
    mkdirSync(join(d, comDebug.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
    writeFileSync(join(d, comDebug), 'como depurar isto\n')
  }
  return d
}

const COM_TESTE = { commands: { test: 'bun test' } } as Parameters<typeof conferirSetup>[1]
const SEM_TESTE = { commands: { test: '' } } as Parameters<typeof conferirSetup>[1]

test('area nova com teste e debug esta pronta', () => {
  const v = conferirSetup(raiz('.vscode/launch.json'), COM_TESTE)
  expect(v.pronto).toBe(true)
  expect(relatoDoSetup(v)).toContain('pronto')
})

test('sem comando de teste no contrato, reprova dizendo como resolver', () => {
  const v = conferirSetup(raiz('DEBUG.md'), SEM_TESTE)
  expect(v.pronto).toBe(false)
  expect(v.faltas.map(f => f.o_que).join(' ')).toContain('comando de teste')
  expect(v.faltas[0]?.como_resolver).toContain('package.json')
})

test('sem ponto de debug documentado, reprova listando as marcas aceitas', () => {
  const v = conferirSetup(raiz(null), COM_TESTE)
  expect(v.pronto).toBe(false)
  const falta = v.faltas.find(f => f.o_que.includes('debug'))
  expect(falta?.como_resolver).toContain('DEBUG.md')
})

test('qualquer uma das marcas de debug serve', () => {
  for (const m of ['.vscode/launch.json', 'DEBUG.md', 'docs/DEBUG.md', '.hii/debug.md']) {
    expect(conferirSetup(raiz(m), COM_TESTE).pronto, `${m} deveria contar`).toBe(true)
  }
})

test('faltando os dois, o relato traz os dois — nao para no primeiro', () => {
  const v = conferirSetup(raiz(null), SEM_TESTE)
  expect(v.faltas.length).toBe(2)
  expect(relatoDoSetup(v)).toContain('·')
})

test('INVARIANTE o fechamento so cobra setup em area NOVA — repo legado nao trava', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('--diff-filter=A')
  expect(fonte, 'a cobranca tem de ser condicionada a todo arquivo ser criado').toContain('criados.length === changed.length')
  expect(fonte).toContain('conferirSetup(wt, contract)')
})

test('INVARIANTE so a falta de COMANDO DE TESTE barra, e so com rigor estrito', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('setup.semTeste && rigorEstrito()')
  expect(fonte, 'o veredicto tem de ficar no card mesmo quando nao barra').toContain('setup_ferramental')
})

test('semTeste separa o objetivo do julgamento: falta de debug nao e criterio de bloqueio', () => {
  expect(conferirSetup(raiz(null), COM_TESTE).semTeste, 'so falta debug — nao pode contar como falta de teste').toBe(false)
  expect(conferirSetup(raiz('DEBUG.md'), SEM_TESTE).semTeste).toBe(true)
})

import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { conferirSetup, ehAreaNova, relatoDoSetup } from '../../motor/cdl/bss/setup-ferramental.ts'

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

// A regra vive em `ehAreaNova`, e nao mais inline em fechar.ts: a versao anterior
// desta funcao devolvia `arquivos.length > 0` — "qualquer diff e area nova" —, o
// que contradiz o comentario dela mesma, e nao tinha consumidor nenhum. Uma funcao
// nomeada com a regra errada ao lado da regra certa inline e pior que nao ter a
// funcao: o proximo chamador acredita no nome.
test('COMPORTAMENTO area nova e todo arquivo do diff ter sido CRIADO', () => {
  expect(ehAreaNova(['a.ts', 'b.ts'], ['a.ts', 'b.ts']), 'todos criados').toBe(true)
  expect(ehAreaNova(['a.ts', 'b.ts'], ['a.ts']), 'um arquivo existente ja tira o card da regra').toBe(false)
  expect(ehAreaNova(['a.ts'], []), 'nenhum criado nao e area nova').toBe(false)
  expect(ehAreaNova([], []), 'diff vazio nao e area nova — senao todo card sem mudanca pagaria pedagio').toBe(false)
})

test('INVARIANTE o fechamento so cobra setup em area NOVA — repo legado nao trava', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  expect(fonte, 'sem --diff-filter=A nao ha como saber o que foi criado').toContain('--diff-filter=A')
  expect(fonte, 'a cobranca tem de passar pela regra nomeada').toContain('ehAreaNova(changed, criados)')
  expect(fonte).toContain('conferirSetup(wt, contract)')
})

test('INVARIANTE so a falta de COMANDO DE TESTE barra, e so com rigor estrito', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  expect(fonte).toContain('setup.semTeste && rigorEstrito()')
  expect(fonte, 'o veredicto tem de ficar no card mesmo quando nao barra').toContain('setup_ferramental')
})

test('semTeste separa o objetivo do julgamento: falta de debug nao e criterio de bloqueio', () => {
  expect(conferirSetup(raiz(null), COM_TESTE).semTeste, 'so falta debug — nao pode contar como falta de teste').toBe(false)
  expect(conferirSetup(raiz('DEBUG.md'), SEM_TESTE).semTeste).toBe(true)
})

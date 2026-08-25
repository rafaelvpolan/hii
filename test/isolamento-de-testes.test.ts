import { tmpdir } from 'node:os'
import { test, expect } from './apoio/runner.ts'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIR = join(import.meta.dirname)

export function arquivosDeTeste(raiz: string = DIR): string[] {
  const achados: string[] = []
  for (const item of readdirSync(raiz, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.')) continue
    const caminho = join(raiz, item.name)
    if (item.isDirectory()) achados.push(...arquivosDeTeste(caminho))
    else if (item.name.endsWith('.test.ts')) achados.push(caminho)
  }
  return achados
}

export const ESCREVEM = /createCard|patchCard|updateCard|core\.submit|instruir\(|answerClarify|remover\(|removerLote|dispatch\(/
export const ISOLAM = /HICODE_CARDS_DIR/

test('REGRESSAO todo teste que escreve card isola HICODE_CARDS_DIR', () => {
  const culpados: string[] = []
  for (const nome of arquivosDeTeste()) {
    const fonte = readFileSync(nome, 'utf8')
    if (ESCREVEM.test(fonte) && !ISOLAM.test(fonte)) culpados.push(relative(DIR, nome))
  }
  expect(culpados, 'escrevem card sem isolar o diretorio — vazam para cards/ de verdade').toEqual([])
})

test('REGRESSAO teste que le variavel de terminal fixa o valor que testa', () => {
  const culpados: string[] = []
  for (const nome of arquivosDeTeste()) {
    const fonte = readFileSync(nome, 'utf8')
    const usaLink = /\blink\(|linkificar\(/.test(fonte)
    if (usaLink && !/HICODE_HYPERLINKS/.test(fonte)) culpados.push(nome)
  }
  expect(culpados, 'dependem do terminal de quem roda — verdes local, vermelhos na CI').toEqual([])
})

test('REGRESSAO nenhum teste aponta para o config real do repo', () => {
  const culpados: string[] = []
  for (const nome of arquivosDeTeste()) {
    const fonte = readFileSync(nome, 'utf8')
    if (/config\/(repos|ia|modelos)\.json/.test(fonte) && !/tmpdir|mkdtemp/.test(fonte)) culpados.push(nome)
  }
  expect(culpados, 'mexem no config local do usuario').toEqual([])
})

// A prova roda numa raiz TEMPORARIA, e nao dentro de `test/`.
//
// Plantar o diretorio no `test/` de verdade e mutacao de estado COMPARTILHADO — a
// mesma coisa que este arquivo inteiro existe para proibir. Sob `bun test` passava
// porque os arquivos nao corriam ao mesmo tempo; sob `node --test`, que roda em
// processos paralelos, o teste que varre `test/` via o diretorio no ar e reprovava.
// O defeito era deste teste, e so o runner paralelo o mostrou.
test('REGRESSAO o guarda enxerga subpasta — mover teste para test/hii/ nao pode desarma-lo', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'hii-prova-subpasta-'))
  const sub = join(raiz, 'subpasta')
  const arquivo = join(sub, 'plantado.test.ts')
  mkdirSync(sub, { recursive: true })
  writeFileSync(arquivo, "import { createCard } from '../../motor/cdl/store'\ncreateCard({}, '')\n")
  try {
    const achados = arquivosDeTeste(raiz)
    expect(achados.some(f => f.endsWith('plantado.test.ts')), 'o guarda nao enxergou a subpasta').toBe(true)
    const culpados = achados
      .filter(f => ESCREVEM.test(readFileSync(f, 'utf8')) && !ISOLAM.test(readFileSync(f, 'utf8')))
      .map(f => relative(raiz, f))
    expect(culpados).toContain(join('subpasta', 'plantado.test.ts'))
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

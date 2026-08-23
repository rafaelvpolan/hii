import { test, expect } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('clone recem-feito sem cards/ consegue criar o primeiro card — ENOENT era erro de instalacao', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'hii-vazio-'))
  const antes = process.env.HICODE_CARDS_DIR
  process.env.HICODE_CARDS_DIR = join(raiz, 'cards')
  try {
    const { createCard, garantirCardsDir } = await import('../../motor/cdl/store')
    expect(existsSync(join(raiz, 'cards'))).toBe(false)
    garantirCardsDir()
    expect(existsSync(join(raiz, 'cards'))).toBe(true)
    rmSync(join(raiz, 'cards'), { recursive: true })
    const id = createCard({ title: 'primeira tarefa', repo: 'org/app' }, 'corpo da tarefa')
    expect(existsSync(join(raiz, 'cards', `${id}-primeira-tarefa.md`))).toBe(true)
  } finally {
    if (antes === undefined) delete process.env.HICODE_CARDS_DIR
    else process.env.HICODE_CARDS_DIR = antes
    rmSync(raiz, { recursive: true, force: true })
  }
})

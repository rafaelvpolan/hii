import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, readFileSync, renameSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gravarRelatorio } from './e2e/relatorio.ts'

test('relatorio parcial conserva etapa, runtime e links relativos depois de movido', () => {
  const base = mkdtempSync(join(tmpdir(), 'hii-relatorio-'))
  const origem = join(base, 'origem')
  const movido = join(base, 'movido')
  try {
    gravarRelatorio(origem, [], { commit: 'abc123', runtime: 'node24', etapa: 'ias', resultado: 'falha', colunas: 48, linhas: 36, erro: 'Indicadores ausentes' })
    renameSync(origem, movido)
    const manifesto = JSON.parse(readFileSync(join(movido, 'manifesto.json'), 'utf8'))
    expect(manifesto.resultado).toBe('falha')
    expect(manifesto.etapa).toBe('ias')
    expect(manifesto.commit).toBe('abc123')
    expect(manifesto.runtime).toBe('node24')
    const html = readFileSync(join(movido, 'processo-orquestracao.html'), 'utf8')
    expect(html).not.toContain('file://')
    expect(html).toContain('Indicadores ausentes')
    expect(html).not.toContain('id="tui-capturas-iniciais"')
    expect(html).toContain('href="docs/orquestracao-passiva.md"')
    expect(existsSync(join(movido, 'docs/orquestracao-passiva.md'))).toBe(true)
    expect(existsSync(join(movido, 'docs/conexao-hicode/openapi.json'))).toBe(true)
  } finally { rmSync(base, { recursive: true, force: true }) }
})

import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotDoAmbiente, candidatosNaPergunta, instalado } from '../lib/runner/ambiente'

test('REGRESSAO: "tem X instalado" e respondivel — o motor entrega o fato, nao a IA adivinha', () => {
  const registro = join(mkdtempSync(join(tmpdir(), 'hicode-repos-ambiente-')), 'repos.json')
  writeFileSync(registro, JSON.stringify([{ name: 'acme/site', path: '/tmp/acme-site' }]))
  process.env.HICODE_REPOS_FILE = registro

  const s = snapshotDoAmbiente('tem acesso ao ntn-cli? qual projeto esta configurado?')
  expect(s).toContain('ntn-cli')
  expect(s).toMatch(/ntn-cli: (NAO )?instalado/)
  expect(s).toContain('projetos registrados')
  expect(s).toContain('acme/site')
  delete process.env.HICODE_REPOS_FILE
})

test('o snapshot sempre cobre os CLIs que o motor usa', () => {
  const s = snapshotDoAmbiente('pergunta qualquer')
  for (const c of ['claude', 'codex', 'ollama', 'gh', 'git']) expect(s, c).toContain(c)
})

test('candidatos vem da pergunta, sem ruido de artigo e preposicao', () => {
  const c = candidatosNaPergunta('tem acesso ao ntn-cli e ao docker-compose?')
  expect(c).toContain('ntn-cli')
  expect(c).toContain('docker-compose')
  expect(c).not.toContain('ao')
  expect(c).not.toContain('tem')
})

test('o snapshot nao inventa — quem nao esta no PATH sai como NAO instalado', () => {
  expect(instalado('binario-que-nao-existe-12345')).toBe(false)
  expect(snapshotDoAmbiente('tem binario-que-nao-existe-12345?')).toContain('binario-que-nao-existe-12345: NAO instalado')
})

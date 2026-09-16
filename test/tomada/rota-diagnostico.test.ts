import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registrarTrocaDeIaNoLiveLog, contextoDaTrocaDeIa } from '../../motor/tomada/rota-log.ts'
import { redigirDiagnostico } from '../../motor/tomada/diagnostico.ts'
import { submit } from '../../motor/mirante/acoes.ts'

let base = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  base = mkdtempSync(join(tmpdir(), 'hii-rota-diagnostico-'))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_TEST_SECRET = 'segredo-do-ambiente'
  mkdirSync(process.env.HII_CARDS_DIR)
})
afterEach(() => { process.env = env; rmSync(base, { recursive: true, force: true }) })

test('troca resume falha antes do destino e aponta diagnostico integral sem credenciais', () => {
  const id = submit({ title: 'retomada', repo: 'org/app' })
  const detalhe = 'segredo-do-ambiente Authorization: Bearer token-nao-na-env\n' +
    '{"api_key":"chave-json-nao-na-env"}\n' + 'detalhe util '.repeat(300) + '\nFIM-DIAGNOSTICO'
  const troca = { id, papel: 'implement' as const, de: 'codex', para: 'claude', falha: 'cota semanal esgotada', detalhe, motivo: 'destino autenticado' }
  registrarTrocaDeIaNoLiveLog(troca)
  const log = readFileSync(join(base, 'cards', 'runs', `${id}.live.log`), 'utf8')
  expect(log).toContain('IA codex falhou: cota semanal esgotada')
  expect(log.indexOf('IA codex falhou')).toBeLessThan(log.indexOf('mudando automaticamente para claude'))
  expect(log).toContain('diagnostico: ')
  expect(log).not.toContain('FIM-DIAGNOSTICO')
  const diagnosticos = readdirSync(join(base, 'cards', 'diagnosticos')).filter(f => f.endsWith('.diagnostico.json'))
  expect(diagnosticos.length).toBe(1)
  const caminho = join(base, 'cards', 'diagnosticos', diagnosticos[0]!)
  expect(log).toContain(caminho)
  const diagnostico = readFileSync(caminho, 'utf8')
  expect(diagnostico).toContain('FIM-DIAGNOSTICO')
  expect(diagnostico).toContain('[REDACTED]')
  for (const saida of [log, diagnostico, contextoDaTrocaDeIa(troca)]) {
    for (const segredo of ['segredo-do-ambiente', 'token-nao-na-env', 'chave-json-nao-na-env']) expect(saida).not.toContain(segredo)
  }
})


test('falha ao gravar diagnostico nao interrompe a troca nem anuncia arquivo inexistente', () => {
  const id = submit({ title: 'diagnostico indisponivel', repo: 'org/app' })
  writeFileSync(join(base, 'cards', 'diagnosticos'), 'caminho ocupado')
  registrarTrocaDeIaNoLiveLog({ id, papel: 'implement', de: 'codex', para: 'claude', falha: 'cota esgotada', detalhe: 'erro integral', motivo: 'apto' })
  const log = readFileSync(join(base, 'cards', 'runs', `${id}.live.log`), 'utf8')
  expect(log).toContain('mudando automaticamente para claude')
  expect(log).toContain('diagnostico indisponivel')
  expect(log).not.toContain('.diagnostico.json')
})

test('credenciais compostas JSON e atribuicoes sao redigidas sem apagar diagnostico util', () => {
  for (const chave of ['access_token', 'refresh_token', 'id_token', 'client_secret', 'accessToken']) {
    for (const texto of [`{"${chave}":"sentinela-composta"}`, `${chave}=sentinela-composta`, `'${chave}': 'sentinela-composta'`]) {
      expect(redigirDiagnostico(texto + '\nquota semanal')).not.toContain('sentinela-composta')
      expect(redigirDiagnostico(texto + '\nquota semanal')).toContain('quota semanal')
    }
  }
})

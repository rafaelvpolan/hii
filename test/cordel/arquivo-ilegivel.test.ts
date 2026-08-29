import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readPackageJson } from '../../motor/cordel/bussola/detectar.ts'
import { readContract } from '../../motor/cordel/bussola/armazenar.ts'
import { esquecerAvisosDeArquivo } from '../../motor/cordel/alicerce/aviso.ts'

// "Ausente" e "corrompido" tinham a MESMA resposta (null), e as consequencias sao
// opostas: ausente e o estado inicial normal; corrompido significa que existe
// configuracao escrita que o motor vai ignorar, pulando gate em silencio.

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-ilegivel-'))
  esquecerAvisosDeArquivo()
})

function capturarStderr<T>(corpo: () => T): { valor: T; saida: string } {
  const original = process.stderr.write.bind(process.stderr)
  let saida = ''
  process.stderr.write = ((chunk: string | Uint8Array): boolean => { saida += String(chunk); return true }) as typeof process.stderr.write
  try {
    return { valor: corpo(), saida }
  } finally {
    process.stderr.write = original
  }
}

test('package.json AUSENTE e silencio — e o estado normal de um diretorio qualquer', () => {
  const r = capturarStderr(() => readPackageJson(dir))
  expect(r.valor).toBeNull()
  expect(r.saida, 'avisar sobre ausencia normal e ruido que treina o operador a ignorar aviso').toBe('')
})

test('package.json CORROMPIDO avisa, e diz que os gates vao ser pulados', () => {
  writeFileSync(join(dir, 'package.json'), '{ isto nao e json')
  const r = capturarStderr(() => readPackageJson(dir))
  expect(r.valor).toBeNull()
  expect(r.saida).toContain('ILEGIVEL')
  expect(r.saida, 'o operador precisa saber a CONSEQUENCIA, nao so que o arquivo esta ruim').toContain('PULADOS')
})

test('o aviso sai UMA vez por caminho — leitor em caminho quente nao pode inundar o terminal', () => {
  writeFileSync(join(dir, 'package.json'), 'nao json')
  const r = capturarStderr(() => {
    readPackageJson(dir)
    readPackageJson(dir)
    readPackageJson(dir)
  })
  expect(r.saida.split('ILEGIVEL').length - 1).toBe(1)
})

function comContrato(conteudo: string): string {
  mkdirSync(join(dir, '.hii'), { recursive: true })
  writeFileSync(join(dir, '.hii', 'contract.json'), conteudo)
  return dir
}

test('contrato AUSENTE e silencio — alvo ainda nao sondado', () => {
  const r = capturarStderr(() => readContract(dir))
  expect(r.valor).toBeNull()
  expect(r.saida).toBe('')
})

test('contrato CORROMPIDO avisa em vez de virar "alvo sem contrato"', () => {
  const r = capturarStderr(() => readContract(comContrato('{"version": 1, truncad')))
  expect(r.valor).toBeNull()
  expect(r.saida).toContain('ILEGIVEL')
  expect(r.saida).toContain('sem os gates')
})

test('contrato de VERSAO desconhecida avisa dizendo qual versao veio', () => {
  const r = capturarStderr(() => readContract(comContrato(JSON.stringify({ version: 99 }))))
  expect(r.valor).toBeNull()
  expect(r.saida).toContain('99')
})

test('contrato valido continua sendo lido sem aviso', () => {
  const bom = JSON.stringify({
    version: 1, generated: '', hash: 'h', shape: 'single', packageManager: 'npm',
    monorepo: false, main: '', packages: [], stack: 'TypeScript',
    commands: { build: '', test: '', lint: '', typecheck: '', dev: '' }, sources: [],
  })
  const r = capturarStderr(() => readContract(comContrato(bom)))
  expect(r.valor?.stack).toBe('TypeScript')
  expect(r.saida).toBe('')
})

// `ia.json` corrompido virava preferencia vazia em silencio: o operador escolheu
// provedor/modelo/esforco e o motor gastava token em OUTRA coisa sem avisar.
// Truncamento deste arquivo e incidente atestado no proprio repo.
test('ia.json CORROMPIDO avisa, dizendo que as preferencias NAO foram aplicadas', async () => {
  const { preferencias } = await import('../../motor/tomada/preferencias.ts')
  const f = join(dir, 'ia.json')
  writeFileSync(f, '{"gate": {"provider": "cod')
  const anterior = process.env.HICODE_IA_FILE
  process.env.HICODE_IA_FILE = f
  try {
    const r = capturarStderr(() => preferencias())
    expect(r.valor).toEqual({})
    expect(r.saida).toContain('ILEGIVEL')
    expect(r.saida, 'o operador precisa saber que a escolha dele nao valeu').toContain('NAO foram aplicadas')
  } finally {
    if (anterior === undefined) delete process.env.HICODE_IA_FILE
    else process.env.HICODE_IA_FILE = anterior
  }
})

test('.hii/config.json CORROMPIDO nao vira "sem preferencia declarada"', async () => {
  const { lerProjectConfig } = await import('../../motor/cordel/alicerce/home.ts')
  mkdirSync(join(dir, '.hii'), { recursive: true })
  writeFileSync(join(dir, '.hii', 'config.json'), '{ base: main }')
  const r = capturarStderr(() => lerProjectConfig(dir))
  expect(r.valor.ilegivel, 'ausente e {} — corrompido tem de ser distinguivel').toBeTruthy()
  expect(r.valor.config).toEqual({})
  expect(r.saida).toContain('ILEGIVEL')
})

test('.hii/config.json AUSENTE continua sendo silencio e objeto vazio', async () => {
  const { lerProjectConfig } = await import('../../motor/cordel/alicerce/home.ts')
  const r = capturarStderr(() => lerProjectConfig(dir))
  expect(r.valor).toEqual({ config: {}, ilegivel: '' })
  expect(r.saida).toBe('')
})

// O sinal de ilegibilidade morava DENTRO de ProjectConfig, no mesmo namespace das
// chaves de verdade: um arquivo legitimo com `"ilegivel": true` fazia o doctor
// reportar "nao deu para ler" sobre um JSON perfeitamente valido.
test('config legitimo com a chave "ilegivel" NAO e confundido com arquivo corrompido', async () => {
  const { lerProjectConfig } = await import('../../motor/cordel/alicerce/home.ts')
  mkdirSync(join(dir, '.hii'), { recursive: true })
  writeFileSync(join(dir, '.hii', 'config.json'), JSON.stringify({ base: 'develop', ilegivel: true }))
  const r = capturarStderr(() => lerProjectConfig(dir))
  expect(r.valor.ilegivel, 'o sentinela nao pode vir do CONTEUDO do arquivo').toBe('')
  expect(r.valor.config.base).toBe('develop')
  expect(r.saida).toBe('')
})

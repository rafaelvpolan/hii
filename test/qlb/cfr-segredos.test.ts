import { test, expect, afterAll } from 'bun:test'

const S = await import('../../motor/qlb/cfr/segredos')

const NOME = 'HICODE_SEGREDO_DE_TESTE'
afterAll(() => { delete process.env[NOME] })

test('o provedor de ambiente e sempre o caminho disponivel — nao precisa de nuvem para funcionar', () => {
  expect(S.provedorPadrao().id).toBe('env')
})

test('segredo presente e devolvido', async () => {
  process.env[NOME] = 'valor-secreto'
  expect(await S.segredo(NOME)).toBe('valor-secreto')
})

test('segredo AUSENTE lanca dizendo o nome e onde definir — nunca string vazia', async () => {
  delete process.env[NOME]
  let msg = ''
  try {
    await S.segredo(NOME)
  } catch (e) {
    msg = String((e as Error).message)
  }
  expect(msg, 'devolver vazio faria a chamada de IA falhar depois, longe da causa').toContain(NOME)
  expect(msg).toContain('variavel de ambiente')
})

test('segredo vazio ou so espaco conta como AUSENTE — definido sem valor e pior que indefinido', async () => {
  for (const vazio of ['', '   ', '\n']) {
    process.env[NOME] = vazio
    await expect(S.segredo(NOME)).rejects.toThrow(NOME)
  }
})

test('cofre opcional vence o ambiente quando registrado, e o id fica visivel', async () => {
  const cofre = { id: 'cofre-de-teste', get: async (n: string): Promise<string> => `do-cofre:${n}` }
  const anterior = S.provedorAtual()
  S.usarProvedor(cofre)
  try {
    expect(S.provedorAtual().id).toBe('cofre-de-teste')
    expect(await S.segredo(NOME)).toBe(`do-cofre:${NOME}`)
  } finally {
    S.usarProvedor(anterior)
  }
})

test('cofre que devolve vazio NAO cai calado no ambiente — falha visivel', async () => {
  process.env[NOME] = 'valor-do-ambiente'
  const cofreQuebrado = { id: 'cofre-quebrado', get: async (): Promise<string> => '' }
  const anterior = S.provedorAtual()
  S.usarProvedor(cofreQuebrado)
  try {
    await expect(S.segredo(NOME), 'cair no ambiente esconderia cofre mal configurado').rejects.toThrow('cofre-quebrado')
  } finally {
    S.usarProvedor(anterior)
  }
})

test('INVARIANTE zero SDK de nuvem no motor — portabilidade e o ponto do item 28', async () => {
  const { readdirSync, statSync, readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const varrer = (raiz: string): string[] => readdirSync(raiz).flatMap(n => {
    const c = join(raiz, n)
    return statSync(c).isDirectory() ? varrer(c) : (n.endsWith('.ts') ? [c] : [])
  })
  const arquivos = varrer('motor')
  expect(arquivos.length).toBeGreaterThan(100)
  const SDK = /aws-sdk|@aws-sdk|@azure\/|@google-cloud/
  const culpados = arquivos.filter(f => SDK.test(readFileSync(f, 'utf8')))
  expect(culpados, 'SDK de nuvem no motor amarra o hii a um provedor').toEqual([])
  const pkg = readFileSync('package.json', 'utf8')
  expect(SDK.test(pkg), 'nem como dependencia declarada').toBe(false)
})

test('SWARM segredo vem de arquivo em /run/secrets/<nome>, minusculo', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'hicode-secrets-'))
  writeFileSync(join(dir, 'anthropic_api_key'), 'chave-do-swarm\n')
  const anterior = S.provedorAtual()
  S.usarProvedor(S.provedorDeArquivo(dir))
  try {
    expect(await S.segredo('ANTHROPIC_API_KEY'), 'o swarm nomeia o segredo em minusculo').toBe('chave-do-swarm')
  } finally {
    S.usarProvedor(anterior)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SWARM segredo declarado mas nao montado LANCA nomeando o caminho esperado', async () => {
  const anterior = S.provedorAtual()
  S.usarProvedor(S.provedorDeArquivo('/run/secrets-que-nao-existe'))
  try {
    await expect(S.segredo('GH_TOKEN')).rejects.toThrow('/run/secrets-que-nao-existe')
  } finally {
    S.usarProvedor(anterior)
  }
})

test('sem HICODE_SECRETS_DIR o padrao segue sendo o ambiente — nuvem nunca e requisito', () => {
  delete process.env.HICODE_SECRETS_DIR
  expect(S.provedorDoAmbienteOuArquivo().id).toBe('env')
  process.env.HICODE_SECRETS_DIR = '/run/secrets'
  try {
    expect(S.provedorDoAmbienteOuArquivo().id).toBe('arquivo')
  } finally {
    delete process.env.HICODE_SECRETS_DIR
  }
})

import { test, expect, lerArquivo } from '../apoio/runner.ts'
import {
  lerLinhaDeServidor, lerListaDeServidores, lerEscopo, combinam, disponibilidadeExterna,
} from '../../motor/tomada/ponte/estado.ts'
import type { ConsultaMcp, ServidorMcp } from '../../motor/tomada/ponte/estado.ts'

const LISTA = [
  'Checking MCP server health…',
  '',
  'claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected',
  'claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication',
  'plugin:Notion:notion: https://mcp.notion.com/mcp (HTTP) - ✔ Connected',
].join('\n')

const consulta = (servidores: ServidorMcp[], escopos: Record<string, 'dinamico' | 'persistente'> = {}): ConsultaMcp => ({
  servidores: async () => ({ servidores, falhou: '' }),
  escopo: async (nome) => ({ escopo: escopos[nome] ?? 'persistente', falhou: '' }),
  prefixo: (nome) => `mcp__${nome.replace(/[^a-zA-Z0-9]+/g, '_')}`,
})

test('le o estado de cada servidor, nao so o nome', () => {
  const s = lerListaDeServidores(LISTA)
  expect(s).toHaveLength(3)
  expect(s.find(x => x.nome === 'claude.ai Slack')?.estado).toBe('conectado')
  expect(s.find(x => x.nome === 'claude.ai Linear')?.estado).toBe('precisa-auth')
})

test('linha de cabecalho e linha vazia nao viram servidor', () => {
  expect(lerLinhaDeServidor('Checking MCP server health…')).toBeNull()
  expect(lerLinhaDeServidor('')).toBeNull()
})

test('escopo dinamico e reconhecido — nao chega no subprocesso do motor', () => {
  expect(lerEscopo('plugin:Notion:notion:\n  Scope: Dynamic config (from command line)\n  Status: ✔ Connected')).toBe('dinamico')
  expect(lerEscopo('x:\n  Scope: User config\n  Status: ✔ Connected')).toBe('persistente')
})

test('combinam ignora acento e caixa', () => {
  expect(combinam('notion', 'plugin:Notion:notion')).toBe(true)
  expect(combinam('slack', 'claude.ai Slack')).toBe(true)
  expect(combinam('notion', 'claude.ai Slack')).toBe(false)
})

test('REGRESSAO: conectado mas de escopo dinamico NAO e usavel — era falso positivo', async () => {
  const r = await disponibilidadeExterna('notion',
    consulta([{ nome: 'plugin:Notion:notion', estado: 'conectado' }], { 'plugin:Notion:notion': 'dinamico' }))
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('sessao interativa')
  expect(r.tools).toEqual([])
})

test('precisa-auth NAO e usavel, e o motivo diz que o motor nao roda OAuth', async () => {
  const r = await disponibilidadeExterna('linear', consulta([{ nome: 'claude.ai Linear', estado: 'precisa-auth' }]))
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('OAuth')
})

test('conectado e persistente e usavel, com o prefixo certo', async () => {
  const r = await disponibilidadeExterna('slack', consulta([{ nome: 'claude.ai Slack', estado: 'conectado' }]))
  expect(r.usavel).toBe(true)
  expect(r.tools).toEqual(['mcp__claude_ai_Slack'])
})

test('servidor ausente da lista e reportado como ausente, nao como sem permissao', async () => {
  const r = await disponibilidadeExterna('trello', consulta([{ nome: 'claude.ai Slack', estado: 'conectado' }]))
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('nenhum servidor MCP')
})

test('estado desconhecido nao passa por conectado', async () => {
  const r = await disponibilidadeExterna('box', consulta([{ nome: 'claude.ai Box', estado: 'desconhecido' }]))
  expect(r.usavel).toBe(false)
})

// "Listei e nao achei" e "nao consegui listar" tinham a MESMA representacao ([]),
// e o motivo entregue ao humano afirmava a primeira nos dois casos — alem de
// classificar a falha como terminal, ou seja HALT sem retry.
test('listagem que FALHOU nao pode ser relatada como "nenhum servidor existe"', async () => {
  const r = await disponibilidadeExterna('omc', {
    servidores: async () => ({ servidores: [], falhou: '"claude mcp list" falhou: command not found' }),
    escopo: async () => ({ escopo: 'persistente' as const, falhou: '' }),
    prefixo: (nome) => nome,
  })
  expect(r.usavel).toBe(false)
  expect(r.motivo, 'afirmar ausencia sem ter conseguido olhar e afirmacao falsa').toContain('nao consegui LISTAR')
  expect(r.motivo).toContain('command not found')
  expect(r.transitorio, 'binario que nao respondeu agora pode responder depois — nao e HALT').toBe(true)
})

test('listagem que DEU e veio vazia continua sendo ausencia de verdade, e nao e transitoria', async () => {
  const r = await disponibilidadeExterna('omc', {
    servidores: async () => ({ servidores: [], falhou: '' }),
    escopo: async () => ({ escopo: 'persistente' as const, falhou: '' }),
    prefixo: (nome) => nome,
  })
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('nenhum servidor MCP')
  expect(r.transitorio).toBeFalsy()
})

test('ESCOPO que nao deu para LER e transitorio — timeout de `mcp get` nao pode virar HALT sem retry', async () => {
  const r = await disponibilidadeExterna('omc', {
    servidores: async () => ({ servidores: [{ nome: 'omc', estado: 'conectado' as const }], falhou: '' }),
    escopo: async () => ({ escopo: 'nao-verificavel' as const, falhou: '"claude mcp get omc" falhou: timeout' }),
    prefixo: (nome) => nome,
  })
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('nao consegui LER o escopo')
  expect(r.transitorio).toBe(true)
})

test('escopo DINAMICO de verdade continua nao sendo transitorio — ali eu OLHEI e vi', async () => {
  const r = await disponibilidadeExterna('omc', {
    servidores: async () => ({ servidores: [{ nome: 'omc', estado: 'conectado' as const }], falhou: '' }),
    escopo: async () => ({ escopo: 'dinamico' as const, falhou: '' }),
    prefixo: (nome) => nome,
  })
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('sessao interativa')
  expect(r.transitorio).toBeFalsy()
})

// O caminho de FALHA da listagem passava por um closure que lia a variavel de
// modulo depois de ela ter sido zerada: `await consulta.servidores()` devolvia
// undefined e `lista.falhou` estourava TypeError. Ou seja, exatamente no caso que
// o tratamento existe para cobrir, a funcao explodia e o card HALTava sem retry.
test('disponibilidadeExterna NAO estoura quando o closure de servidores resolve o valor ja lido', async () => {
  // O bug era este: conectorExterno zerava `estadoCache` ANTES do closure
  // `() => estadoCache` ser chamado, entao `await consulta.servidores()` dava
  // undefined e `lista.falhou` estourava TypeError. A forma correta e o closure
  // devolver o valor JA RESOLVIDO, que e o que este contrato exige.
  const lista = { servidores: [], falhou: '"claude mcp list" falhou: timeout' }
  const r = await disponibilidadeExterna('omc', {
    servidores: () => Promise.resolve(lista),
    escopo: async () => ({ escopo: 'persistente' as const, falhou: '' }),
    prefixo: (nome) => nome,
  })
  expect(r.usavel).toBe(false)
  expect(r.transitorio).toBe(true)
})

test('INVARIANTE conectorExterno resolve a lista ANTES de limpar o cache', async () => {
  const fonte = await lerArquivo('motor/tomada/ponte/mcp.ts')
  // `() => estadoCache` le a variavel de modulo no momento da chamada; depois de
  // `estadoCache = undefined` isso e undefined e o consumidor estoura.
  expect(fonte, 'o closure tem de devolver o valor resolvido, nao a variavel de modulo').toContain('servidores: () => Promise.resolve(lista)')
  expect(fonte).not.toContain('estadoCache as Promise')
})

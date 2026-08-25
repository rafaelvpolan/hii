import { test, expect } from '../apoio/runner.ts'
import { arquivosDaBranch, caminhosDoStatus, lerArgumentos } from '../../scripts/auditar.ts'

// `apenas` (recorte por lista exata de caminhos) existia sem NENHUM chamador de
// codigo — só prosa num SKILL.md. Este script é o consumidor, e estes testes são a
// razão de ele ser script e não trecho de shell inline: um snippet de `-e` com git
// embutido não tem como ser testado.

test('caminhosDoStatus corta por POSICAO — trim antes do corte come o status', () => {
  // ' M a.ts' tem espaco no primeiro caractere: dar trim() antes de cortar fazia o
  // caminho sair como 'M a.ts'. Foi o defeito real da primeira versao deste script.
  expect(caminhosDoStatus(' M motor/a.ts')).toEqual(['motor/a.ts'])
  expect(caminhosDoStatus('?? motor/novo.ts')).toEqual(['motor/novo.ts'])
  expect(caminhosDoStatus('M  motor/b.ts')).toEqual(['motor/b.ts'])
  expect(caminhosDoStatus('A  motor/c.ts')).toEqual(['motor/c.ts'])
})

test('rename devolve o DESTINO, que e o arquivo que existe agora', () => {
  expect(caminhosDoStatus('R  motor/velho.ts -> motor/novo.ts')).toEqual(['motor/novo.ts'])
})

test('linha vazia ou curta nao vira caminho', () => {
  expect(caminhosDoStatus('\n\n M \n')).toEqual([])
  expect(caminhosDoStatus('')).toEqual([])
})

test('arquivosDaBranch une o nao-commitado com o diff vs a base, sem repetir', () => {
  const git = (args: string[]): string => {
    if (args[0] === 'status') return ' M a.ts\n?? b.ts\n'
    if (args[0] === 'diff') return 'a.ts\nc.ts\n'
    throw new Error(`git ${args.join(' ')} inesperado`)
  }
  expect(arquivosDaBranch('main', git).sort()).toEqual(['a.ts', 'b.ts', 'c.ts'])
})

test('base inexistente NAO vira lista vazia — o trabalho em curso continua valendo', () => {
  const git = (args: string[]): string => {
    if (args[0] === 'status') return ' M a.ts\n'
    throw new Error('fatal: bad revision')
  }
  const original = process.stderr.write.bind(process.stderr)
  let saida = ''
  process.stderr.write = ((c: string | Uint8Array): boolean => { saida += String(c); return true }) as typeof process.stderr.write
  try {
    expect(arquivosDaBranch('nao-existe', git)).toEqual(['a.ts'])
    expect(saida, 'devolver lista vazia em silencio faria a auditoria dizer "0 de 0"').toContain('nao consegui comparar')
  } finally {
    process.stderr.write = original
  }
})

test('lerArgumentos separa prefixo de caminho, flags e valores', () => {
  expect(lerArgumentos([])).toEqual({ escopo: '', branch: false, base: 'main', lotes: 0, orcamento: 0 })
  expect(lerArgumentos(['motor/agentes/']).escopo).toBe('motor/agentes/')
  expect(lerArgumentos(['--branch']).branch).toBe(true)
  expect(lerArgumentos(['--base', 'develop']).base).toBe('develop')
  expect(lerArgumentos(['--lotes', '3']).lotes).toBe(3)
  expect(lerArgumentos(['--orcamento', '40000']).orcamento).toBe(40000)
})

test('o VALOR de uma flag nao e confundido com prefixo de caminho', () => {
  // `--base develop` nao pode fazer "develop" virar o recorte de caminho.
  expect(lerArgumentos(['--base', 'develop']).escopo).toBe('')
  expect(lerArgumentos(['--lotes', '3', 'motor/']).escopo).toBe('motor/')
})

test('numero invalido cai no padrao em vez de virar NaN no orcamento', () => {
  expect(lerArgumentos(['--lotes', 'tres']).lotes).toBe(0)
  expect(lerArgumentos(['--orcamento', 'muito']).orcamento).toBe(0)
})

// `apenas: []` significa "sem recorte por lista", ou seja REPO INTEIRO. Com
// `--branch` numa arvore limpa a lista vinha vazia e o plano do repositorio todo
// saia rotulado como "superficie da branch" — e resumoAuditoria so avisa de recorte
// vazio para `escopo`, nunca para `apenas`. Fail-open de escopo.
test('--branch com superficie VAZIA nao audita o repo inteiro rotulado como branch', async () => {
  const { planoDaAuditoria } = await import('../../scripts/auditar.ts')
  const gitLimpo = (args: string[]): string => (args[0] === 'status' ? '' : '')
  const linhas = await planoDaAuditoria(
    { escopo: '', branch: true, base: 'main', lotes: 0, orcamento: 0 },
    gitLimpo,
  )
  const texto = linhas.join('\n')
  expect(texto, 'a superficie vazia tem de ser dita, nao trocada pelo repo inteiro').toContain('VAZIA')
  expect(texto).toContain('NAO e "repositorio limpo"')
  expect(texto, 'nenhum lote pode ser montado sobre recorte vazio').not.toContain('LOTE 1/')
})

test('--branch com superficie de verdade diz QUANTOS arquivos o recorte cobre', async () => {
  const { planoDaAuditoria } = await import('../../scripts/auditar.ts')
  const git = (args: string[]): string => (args[0] === 'status' ? ' M motor/cdl/store.ts\n' : '')
  const texto = (await planoDaAuditoria(
    { escopo: '', branch: true, base: 'main', lotes: 0, orcamento: 0 },
    git,
  )).join('\n')
  expect(texto).toContain('1 arquivo(s) tocados')
  expect(texto).toContain('vale para ELA, nao para o repositorio')
})

test('--branch e BOOLEANA: o argumento seguinte continua sendo o prefixo de caminho', () => {
  expect(lerArgumentos(['--branch', 'motor/agentes/']).escopo, 'o escopo era perdido em silencio').toBe('motor/agentes/')
  expect(lerArgumentos(['--branch', 'motor/agentes/']).branch).toBe(true)
  // E flag COM valor continua consumindo o proprio valor:
  expect(lerArgumentos(['--base', 'develop', 'motor/']).escopo).toBe('motor/')
  expect(lerArgumentos(['--base', 'develop', 'motor/']).base).toBe('develop')
})

test('valor que comeca com -- e outra FLAG, nao valor', () => {
  const original = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((): boolean => true) as typeof process.stderr.write
  try {
    // `--base --lotes 3` fazia base='--lotes' e o plano saia rotulado
    // "superficie da branch vs --lotes".
    expect(lerArgumentos(['--branch', '--base', '--lotes', '3']).base).toBe('main')
    expect(lerArgumentos(['--branch', '--base', '--lotes', '3']).lotes).toBe(3)
    expect(lerArgumentos(['--base']).base, 'flag no fim, sem valor').toBe('main')
  } finally {
    process.stderr.write = original
  }
})

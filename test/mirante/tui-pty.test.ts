import { test, expect } from '../apoio/runner.ts'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { allCards, patchCard, readCard } from '../../motor/cordel/store.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'

test('PTY Linux: teclado real, session, tarefa offline, estado entre processos e saida restaurada', async () => {
  const anterior = { ...process.env }
  const base = mkdtempSync(join(tmpdir(), 'hii-pty-'))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_REPOS_FILE = join(base, 'repos.json')
  process.env.HII_IA_FILE = join(base, 'ia.json')
  mkdirSync(process.env.HII_CARDS_DIR)
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: base, branch: 'main' }]))
  const quote = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`
  const comando = `stty cols 100 rows 36; exec ${quote(process.execPath)} ${quote(resolve('test/fixtures/tui-processo.ts'))}`
  const filho = spawn('script', ['-qefc', comando, '/dev/null'], {
    env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  const saida: string[] = []
  filho.stdout.on('data', b => { saida.push(String(b)) })
  filho.stderr.on('data', b => { saida.push(String(b)) })
  let terminou = false
  const fim = new Promise<number | null>((resolve, reject) => {
    filho.once('error', reject)
    filho.once('exit', code => { terminou = true; resolve(code) })
  })
  const tela = (): string => telaVirtual(saida, 100)
  const ate = async (condicao: () => boolean): Promise<void> => {
    const prazo = Date.now() + 8000
    while (!condicao() && !terminou && Date.now() < prazo) await new Promise(r => setTimeout(r, 25))
    expect(condicao(), tela()).toBe(true)
  }
  try {
    await ate(() => saida.join('').includes('\x1b[?25h'))
    filho.stdin.write('/new conversa PTY\r')
    await ate(() => allCards().length === 1 && tela().includes('conversa PTY'))
    filho.stdin.write('Ajuste o texto do projeto\r')
    await ate(() => allCards().length === 2 && tela().includes('daemon offline'))
    const id = allCards().find(c => c.tipo !== 'session')!.id!
    expect(readCard(id)?.fm.status).toBe('EXECUTING')
    patchCard(id, { status: 'COMPLETED' })
    await ate(() => tela().includes('concluido') && tela().includes('nada em execucao'))
    filho.stdin.write('/ask qual o resultado?\r')
    await ate(() => tela().includes('consulta somente leitura no PTY'))
    expect(allCards().length).toBe(2)
    filho.stdin.write('/exit\r')
    await ate(() => terminou)
    expect(await fim).toBe(0)
    expect(saida.join('')).toContain('\x1b[?1049l')
    expect(saida.join('')).toContain('\x1b[?2004l')
  } finally {
    if (!terminou) {
      filho.stdin.write('\x04')
      await new Promise(r => setTimeout(r, 100))
      if (!terminou) filho.kill('SIGTERM')
    }
    await fim
    process.env = anterior
    rmSync(base, { recursive: true, force: true })
  }
}, 30000)

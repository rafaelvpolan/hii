// varrerPreviewsOrfaos: `startUrl` solta o dev-server com detached+unref de
// proposito (o preview sobrevive ao daemon para o humano olhar a URL); o preco era
// card que ja passou do preview segurando processo e porta para sempre — o card
// 005 carregou url_pid de processo morto por 4 dias. A varredura do arranque limpa
// pid morto de qualquer card e SO mata processo vivo quando prova a identidade:
// /proc/<pid>/cwd dentro do worktree gravado no card. Sem prova, nao mata — vazar
// e mais barato que matar um pid reciclado de outro dono.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-previews-'))
process.env.HICODE_CARDS_DIR = CARDS
const WORKTREE = mkdtempSync(join(tmpdir(), 'hicode-prev-wt-'))
const FORA_DO_WORKTREE = mkdtempSync(join(tmpdir(), 'hicode-prev-fora-'))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { varrerPreviewsOrfaos, pidAlive } = await import('../../motor/ciclo/crivo/url-viva.ts')

const spawnados: number[] = []

function processoVivoEm(cwd: string): number {
  const filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd, detached: true, stdio: 'ignore' })
  filho.unref()
  spawnados.push(filho.pid ?? 0)
  return filho.pid ?? 0
}

async function pidJaMorto(): Promise<number> {
  const filho = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  const pid = filho.pid ?? 0
  await new Promise(r => filho.on('close', r))
  return pid
}

async function esperarMorte(pid: number): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (!pidAlive(String(pid))) return true
    await new Promise(r => setTimeout(r, 50))
  }
  return false
}

afterAll(() => {
  for (const pid of spawnados) {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { void 0 } }
  }
  rmSync(CARDS, { recursive: true, force: true })
  rmSync(WORKTREE, { recursive: true, force: true })
  rmSync(FORA_DO_WORKTREE, { recursive: true, force: true })
})

function cardComPreview(status: string, pid: number, worktree = WORKTREE): string {
  return createCard({ title: `preview ${status}`, status, repo: 'org/repo', url_pid: String(pid), worktree }, '## Objetivo\np\n')
}

test('pid morto limpa em qualquer status; orfao provado morre; URL e pid sem prova ficam vivos', async () => {
  const morto = cardComPreview('URL', await pidJaMorto())
  const pidOrfao = processoVivoEm(WORKTREE)
  const orfao = cardComPreview('HALTED', pidOrfao)
  const pidEmUso = processoVivoEm(WORKTREE)
  const emUrl = cardComPreview('URL', pidEmUso)
  const pidDeOutro = processoVivoEm(FORA_DO_WORKTREE)
  const semProva = cardComPreview('PR_OPEN', pidDeOutro)

  const varrida = varrerPreviewsOrfaos()

  expect(varrida.mortosLimpos).toContain(morto)
  expect(varrida.orfaosParados).toEqual([orfao])
  expect(readCard(morto)?.fm.url_pid).toBe('')
  expect(readCard(orfao)?.fm.url_pid).toBe('')
  expect(await esperarMorte(pidOrfao)).toBe(true)
  expect(pidAlive(String(pidEmUso))).toBe(true)
  expect(readCard(emUrl)?.fm.url_pid).toBe(String(pidEmUso))
  expect(pidAlive(String(pidDeOutro))).toBe(true)
  expect(readCard(semProva)?.fm.url_pid).toBe(String(pidDeOutro))
}, 30000)

test('varredura e idempotente: segunda passada nao acha mais nada', () => {
  const varrida = varrerPreviewsOrfaos()
  expect(varrida.mortosLimpos).toEqual([])
  expect(varrida.orfaosParados).toEqual([])
})

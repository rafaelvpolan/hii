import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT } from '../../motor/cdl/ali/config'
import { renderFleet } from '../../lib/core/render/fleet'
import { daemonPid, daemonStatus, readPrefs, writePrefs } from '../../lib/core/daemon'
import type { SessionState } from '../../lib/core/session'
import { color, dim, say } from './saida'
import { todosOsCards } from './dados'

export function fleet(state: SessionState): void {
  say('')
  say(renderFleet(todosOsCards().filter(c => !state.repo || c.repo === state.repo), { color, repo: state.repo, daemon: daemonStatus() }))
  say('')
}

export async function ensureDaemon(ask: (q: string) => Promise<string | null>): Promise<void> {
  if (daemonPid()) return
  const prefs = readPrefs()
  if (prefs.autostart === 'no') {
    say(dim('  daemon offline — os cards ficam na fila ate voce rodar `hii start`'))
    return
  }
  if (prefs.autostart === 'yes') return start()
  if (!color) {
    say(dim('  daemon offline (sem tty: nao pergunto) — suba com `hii start`'))
    return
  }
  const r = await ask('  daemon offline. subir agora? [s/N/sempre/nunca] ')
  const a = (r ?? '').trim().toLowerCase()
  if (a === 'sempre') { writePrefs({ autostart: 'yes' }); return start() }
  if (a === 'nunca') { writePrefs({ autostart: 'no' }); return }
  if (a === 's' || a === 'sim' || a === 'y') return start()
  say(dim('  seguindo com o daemon offline'))
}

export function start(): void {
  const sh = join(ROOT, 'scripts', 'runner-daemon.sh')
  spawnSync(sh, ['start'], { stdio: 'inherit' })
}

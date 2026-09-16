import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function ambienteTui(base: string): void {
  for (const nome of ['cards', 'bin', 'alvo', 'codex', 'claude', 'kimi', 'skills', 'agents', 'secrets']) mkdirSync(join(base, nome), { recursive: true })
  for (const nome of ['node', 'bun', 'git', 'script', 'stty', 'sh', 'bash', 'sleep', 'tty', 'setsid']) {
    const destino = join(base, 'bin', nome)
    if (!existsSync(destino)) {
      const caminho = execFileSync('/bin/sh', ['-c', 'command -v "$1"', '--', nome], { encoding: 'utf8' }).trim()
      symlinkSync(caminho, destino)
    }
  }
  writeFileSync(join(base, 'bin', 'claude'), '#!/bin/sh\necho "fixture claude: CLI externo proibido" >&2\nexit 91\n', { mode: 0o755 })
  Object.assign(process.env, {
    HII_CARDS_DIR: join(base, 'cards'), HII_IA_FILE: join(base, 'ia.json'),
    HII_REPOS_FILE: join(base, 'repos.json'), HII_MODELOS_FILE: join(base, 'modelos.json'),
    HII_SKILLS_DIR: join(base, 'skills'), HII_AGENTS_DIR: join(base, 'agents'),
    HII_CLAUDE_CONFIG: join(base, 'claude.json'), CODEX_HOME: join(base, 'codex'),
    HII_KIMI_CONFIG: join(base, 'kimi.toml'), HII_JANELAS_CODEX: '5h,7d',
    HII_RUNNER_PIDFILE: join(base, 'runner.pid'), HII_RUNNER_LOCK: join(base, 'runner.lock'),
    HII_RUNNER_LOG: join(base, 'runner.log'), HII_HEALTH_PORT: '0', HII_HEALTH_BIND: '127.0.0.1',
    HII_CLAUDE_HOME_DIR: join(base, 'claude'), HII_KIMI_HOME_DIR: join(base, 'kimi'),
    HII_SECRETS_DIR: join(base, 'secrets'),
    HII_OLLAMA_URL: 'http://127.0.0.1:1',
    HII_QUOTA_FALLBACK: 'on', PATH: join(base, 'bin'),
  })
  writeFileSync(process.env.HII_REPOS_FILE!, JSON.stringify([{ name: 'org/app', path: join(base, 'alvo'), branch: 'main' }]))
  writeFileSync(process.env.HII_MODELOS_FILE!, JSON.stringify({ codex: ['modelo-teste'] }))
}

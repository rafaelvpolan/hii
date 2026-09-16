import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function ambienteTui(base: string): void {
  for (const nome of ['cards', 'bin', 'alvo', 'codex', 'skills', 'agents']) mkdirSync(join(base, nome), { recursive: true })
  Object.assign(process.env, {
    HII_CARDS_DIR: join(base, 'cards'), HII_IA_FILE: join(base, 'ia.json'),
    HII_REPOS_FILE: join(base, 'repos.json'), HII_MODELOS_FILE: join(base, 'modelos.json'),
    HII_SKILLS_DIR: join(base, 'skills'), HII_AGENTS_DIR: join(base, 'agents'),
    HII_CLAUDE_CONFIG: join(base, 'claude.json'), CODEX_HOME: join(base, 'codex'),
    HII_QUOTA_FALLBACK: 'on', PATH: `${join(base, 'bin')}:${process.env.PATH}`,
  })
  writeFileSync(process.env.HII_REPOS_FILE!, JSON.stringify([{ name: 'org/app', path: join(base, 'alvo'), branch: 'main' }]))
  writeFileSync(process.env.HII_MODELOS_FILE!, JSON.stringify({ codex: ['modelo-teste'] }))
}

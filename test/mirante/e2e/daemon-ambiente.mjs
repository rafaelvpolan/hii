import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Child processes receive an allowlist, never the developer's credentials or provider PATH.
export function ambienteDaemon() {
  const base = mkdtempSync(join(tmpdir(), 'hii-daemon-e2e-'))
  for (const dir of ['bin', 'home', 'codex', 'cards/runs', 'skills', 'agents', 'alvo', 'outro', 'engine']) mkdirSync(join(base, dir), { recursive: true })
  const bin = join(base, 'bin')
  for (const name of ['node', 'bun', 'git', 'sh', 'bash', 'script', 'stty', 'sleep', 'which', 'setsid']) {
    const path = execFileSync('/bin/sh', ['-c', 'command -v "$1"', '--', name], { encoding: 'utf8' }).trim()
    symlinkSync(path, join(bin, name))
  }
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "E2E: GitHub externo proibido" >&2\nexit 91\n', { mode: 0o755 })
  writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const base = process.env.HII_E2E_BASE;
if (!base || !existsSync(join(base, 'isolado'))) process.exit(90);
if (process.argv.includes('--version')) { console.log('codex fixture'); process.exit(0); }
const args = process.argv.slice(2);
if (args[0] !== 'exec' || !args[1].includes('Preserve a API publica')) process.exit(92);
const cwd = args[args.indexOf('-C') + 1];
const retomou = existsSync(join(cwd, 'parcial.txt'));
appendFileSync(join(base, 'chamadas.jsonl'), JSON.stringify({ pid: process.pid, cwd, retomou, prompt: args[1] }) + '\\n');
writeFileSync(join(cwd, 'parcial.txt'), 'trabalho preservado');
const emit = text => console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
emit(retomou ? 'RETOMADA_REAL_CONFIRMADA' : 'EXECUCAO_REAL_INICIADA');
const timer = setInterval(() => {
  if (!existsSync(join(base, 'liberar-fim'))) return;
  clearInterval(timer);
  emit('RESULTADO_REAL_UNICO');
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 4, output_tokens: 2 } }));
}, 40);
`, { mode: 0o755 })
  writeFileSync(join(base, 'isolado'), '')
  writeFileSync(join(base, 'codex/auth.json'), '{}')
  writeFileSync(join(base, 'cards/runs/.repl.json'), JSON.stringify({ autostart: 'no' }))
  const additional = Array.from({ length: 22 }, (_, index) => `projeto-${String(index + 1).padStart(2, '0')}`)
  writeFileSync(join(base, 'repos.json'), JSON.stringify([
    { name: 'e2e/app', path: join(base, 'alvo'), branch: 'main' },
    { name: 'e2e/outro', path: join(base, 'outro'), branch: 'main' },
    ...additional.map(name => ({ name: `e2e/${name}`, path: join(base, name), branch: 'main' })),
  ]))
  writeFileSync(join(base, 'modelos.json'), JSON.stringify({ codex: ['fixture'] }))
  copyFileSync(resolve('config/model-tier.json'), join(base, 'model-tier.json'))
  const env = {
    PATH: bin, HOME: join(base, 'home'), LANG: 'C.UTF-8', TERM: 'xterm-256color',
    HII_E2E_BASE: base, HII_ROOT: join(base, 'engine'), HII_RUNTIME: 'node',
    HII_CARDS_DIR: join(base, 'cards'), HII_REPOS_FILE: join(base, 'repos.json'),
    HII_IA_FILE: join(base, 'ia.json'), HII_MODELOS_FILE: join(base, 'modelos.json'),
    HII_SKILLS_DIR: join(base, 'skills'), HII_AGENTS_DIR: join(base, 'agents'),
    HII_CLAUDE_CONFIG: join(base, 'claude.json'), CODEX_HOME: join(base, 'codex'),
    HII_RUNNER_PIDFILE: join(base, 'runner.pid'), HII_RUNNER_LOCK: join(base, 'runner.lock'),
    HII_RUNNER_LOG: join(base, 'runner.log'), HII_HEALTH_PORT: '0',
    HII_OLLAMA_URL: 'http://127.0.0.1:1', HII_POLL_MS: '100', HII_SHUTDOWN_TIMEOUT_MS: '100',
    HII_TIER_FILE: join(base, 'model-tier.json'), HII_AI_PROVIDER: 'codex', HII_QUOTA_FALLBACK: 'off', HII_RUN_TIMEOUT_MS: '60000',
  }
  for (const name of ['alvo', 'outro', ...additional]) execFileSync(join(bin, 'git'), ['init', '-q', '-b', 'main', join(base, name)], { env })
  return { base, env, cli: (...args) => execFileSync(process.execPath, [resolve('bin/hii.ts'), ...args], { env, encoding: 'utf8', timeout: 15000 }) }
}

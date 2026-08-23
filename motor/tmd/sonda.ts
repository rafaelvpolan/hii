import { run } from '../qlb/git'
import { noProxyArgs } from '../qlb/alf/loopback'

const PROBE_TIMEOUT_MS = Number(process.env.HICODE_HEALTH_PROBE_TIMEOUT_MS || 5000)

// Helper compartilhado. Quem decide QUAL url sondar e cada harness, no proprio
// arquivo — assim harness novo nao precisa editar tabela central nenhuma.
export async function alcancavelPorHttp(url: string): Promise<boolean> {
  const seconds = String(Math.max(1, Math.round(PROBE_TIMEOUT_MS / 1000)))
  const args = ['-q', ...noProxyArgs(url), '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', seconds, url]
  const { err, stdout } = await run('curl', args, { timeout: PROBE_TIMEOUT_MS + 2000 })
  if (err) return false
  const code = Number(stdout.trim()) || 0
  return code > 0 && code < 500
}

export function urlDoOllama(): string {
  return `${process.env.HICODE_OLLAMA_URL || 'http://localhost:11434'}/api/tags`
}

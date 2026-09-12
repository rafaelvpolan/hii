import { run } from '../quilombo/git.ts'
import { noProxyArgs } from '../quilombo/alfandega/loopback.ts'

const PROBE_TIMEOUT_MS = Number(process.env.HII_HEALTH_PROBE_TIMEOUT_MS || 5000)

const CODIGOS_DE_INDISPONIBILIDADE = new Set([403, 408, 429])

const PROBE_BIN_TIMEOUT_MS = Number(process.env.HII_HEALTH_PROBE_BIN_TIMEOUT_MS || 15000)

// O card 002 provou que sondar a URL nao mede a falha: um timeout de 900 s do CLI
// foi "curado" por um GET de 5 s no host da API. A sonda do binario mede quem de
// fato falhou — `--version` responde em menos de 1 s num CLI vivo, e o teto de 15 s
// e folga para maquina carregada, nao para binario travado.
export async function binarioResponde(binario: string): Promise<boolean> {
  const { err } = await run(binario, ['--version'], { timeout: PROBE_BIN_TIMEOUT_MS })
  return !err
}

// E, nao OU: binario que responde nao prova rede, e API alcancavel nao prova que o
// CLI local volta a responder. As duas familias de falha ja aconteceram.
export async function cliSaudavel(binario: string, urlDaApi: string): Promise<boolean> {
  return (await binarioResponde(binario)) && (await alcancavelPorHttp(urlDaApi))
}

// Helper compartilhado. Quem decide QUAL url sondar e cada harness, no proprio
// arquivo — assim harness novo nao precisa editar tabela central nenhuma.
export async function alcancavelPorHttp(url: string): Promise<boolean> {
  const seconds = String(Math.max(1, Math.round(PROBE_TIMEOUT_MS / 1000)))
  const args = ['-q', ...noProxyArgs(url), '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', seconds, url]
  const { err, stdout } = await run('curl', args, { timeout: PROBE_TIMEOUT_MS + 2000 })
  if (err) return false
  const code = Number(stdout.trim()) || 0
  return code > 0 && code < 500 && !CODIGOS_DE_INDISPONIBILIDADE.has(code)
}

export function urlDoOllama(): string {
  return `${process.env.HII_OLLAMA_URL || 'http://localhost:11434'}/api/tags`
}

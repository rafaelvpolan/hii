import { run } from '../quilombo/git.ts'
import { fileURLToPath } from 'node:url'
import { ErroApi } from './contrato.ts'
import type { Json } from './contrato.ts'

let emVoo: Promise<Json> | null = null
async function executarDoctor(): Promise<Json> {
  const script = fileURLToPath(new URL('../../scripts/setup/doctor.mjs', import.meta.url))
  // O executor existente encerra o grupo, inclusive gh/git iniciados pela sonda.
  const { err, stdout } = await run(process.execPath, [script, '--json'], { timeout: 30000, maxBuffer: 512 * 1024 })
  // Exit 1 e um diagnostico com checks reprovados; nao significa JSON invalido.
  if (err && (err.killed || err.code !== 1)) throw new ErroApi(503, 'diagnostico_indisponivel', 'Sonda interrompida, sem resultado completo; repita o diagnostico.')
  try {
    const r = JSON.parse(stdout) as { versao?: number; checks?: Json[]; inferencia?: boolean }
    if (r.versao !== 1 || r.inferencia !== false || !Array.isArray(r.checks)) throw new Error('contrato invalido')
    return r
  } catch { throw new ErroApi(503, 'diagnostico_invalido', 'Sonda nao retornou diagnostico estruturado valido.') }
}

export function diagnosticoDoMotor(executar: () => Promise<Json> = executarDoctor): Promise<Json> {
  // Uma sonda por processo da API; clientes concorrentes compartilham o resultado.
  // O subprocesso evita bloquear SSE/status durante os checks sincronicos do doctor.
  if (!emVoo) emVoo = executar().finally(() => { emVoo = null })
  return emVoo
}

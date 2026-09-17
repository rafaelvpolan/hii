import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ROOT } from '../cordel/alicerce/config.ts'
import { pidFile } from '../oswaldo/mutirao/daemon.ts'
import { lockFile } from '../oswaldo/mutirao/trava-instancia.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { estadoMotor } from './estado-motor.ts'
import type { EstadoMotor } from './estado-motor.ts'
import { ErroApi } from './contrato.ts'

interface Dependencias { consultar: () => EstadoMotor; iniciar: () => boolean; aguardar: () => Promise<void>; prazoMs: number }
function iniciarOficial(): boolean {
  const script = fileURLToPath(new URL('../../scripts/runner-daemon.sh', import.meta.url))
  const r = spawnSync('bash', [script, 'start'], {
    cwd: ROOT, env: { ...process.env, HII_RUNNER_PIDFILE: pidFile(), HII_RUNNER_LOCK: lockFile() },
    timeout: 10000, killSignal: 'SIGKILL', stdio: 'ignore',
  })
  return !r.error && r.status === 0
}
const padrao: Dependencias = { consultar: estadoMotor, iniciar: iniciarOficial, aguardar: () => new Promise(r => setTimeout(r, 100)), prazoMs: 5000 }
let emCurso: Promise<EstadoMotor> | null = null
// Apenas POST autorizado chega aqui; consultas e heartbeat nunca iniciam processos.
export function iniciarMotor(deps: Dependencias = padrao): Promise<EstadoMotor> {
  if (emCurso) return emCurso
  emCurso = executar(deps).finally(() => { emCurso = null })
  return emCurso
}
async function executar(d: Dependencias): Promise<EstadoMotor> {
  const controle = lockFile() + '.arranque'
  withFileLock(controle, () => {
    const s = d.consultar()
    if (s.estado === 'ligado') return
    if (s.estado !== 'desligado') throw new ErroApi(409, 'motor_nao_disponivel', s.motivo)
    let anterior = 0
    try { anterior = Number(readFileSync(controle, 'utf8')) } catch { /* primeiro pedido */ }
    if (Date.now() - anterior < 60000) throw new ErroApi(429, 'arranque_em_espera', 'Aguarde 60 segundos e consulte o estado antes de tentar novamente.')
    writeFileAtomic(controle, String(Date.now()))
    if (!d.iniciar()) throw new ErroApi(503, 'arranque_falhou', 'Motor nao iniciou. Confira o log local e a instalacao; nenhuma tarefa foi retomada pelo pedido.')
  })
  const limite = Date.now() + d.prazoMs
  do {
    const s = d.consultar()
    if (s.estado === 'ligado') return s
    await d.aguardar()
  } while (Date.now() < limite)
  throw new ErroApi(503, 'arranque_sem_confirmacao', 'Motor sem confirmacao de disponibilidade. Consulte o estado antes de reenviar; nao houve reinicio forcado.')
}

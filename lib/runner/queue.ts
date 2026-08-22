import { isoNow } from '../card'
import type { Job } from '../card'
import { MAX_CONCURRENCY } from './config'
import { patchCard } from './card-store'
import { pending, marcarEmVoo, liberar, quantosEmVoo } from './queue-state'
import { handleExecute } from './execute'
import { handleFinish } from './finish'
import { handleCorrect } from './correct'
import { handleSpec } from './spec-phase'
import { checkMerged } from './merge'
import { arquivar, precisaArquivar } from '../core/archive'
import { recordTickSuccess, reportTickFailure } from './health'
import { wakeDueWaiting } from './waiting'
import { limparTmpAntigo, usoDeDisco } from './estado-em-disco'
import { podarRegistrosAntigos } from './podar-registros'

export { reconcileStranded, pending } from './queue-state'


export async function runJob(job: Job): Promise<void> {
  marcarEmVoo(job.id)
  try {
    if (job.kind === 'execute') await handleExecute(job.id)
    else if (job.kind === 'finish') await handleFinish(job.id)
    else if (job.kind === 'spec') await handleSpec(job.id)
    else await handleCorrect(job.id)
  } catch (e) {
    patchCard(job.id, { status: 'HALTED' }, `${isoNow()} HALTED erro: ${String((e as Error)?.message ?? e)}`)
  } finally {
    liberar(job.id)
  }
}

function semDerrubarOTick(chore: () => void): void {
  try {
    chore()
  } catch {
    return
  }
}

function podarTmp(): void {
  semDerrubarOTick(() => {
    const r = limparTmpAntigo()
    if (r.removidos.length) {
      process.stdout.write(`[runner] tmp podado: ${r.removidos.length} item(ns), ${r.bytesLiberados} bytes\n`)
    }
    const registros = podarRegistrosAntigos()
    if (registros.removidos.length) {
      process.stdout.write(`[runner] registros podados: ${registros.removidos.length} conversa(s)/ledger(s), ${registros.bytesLiberados} bytes\n`)
    }
    const uso = usoDeDisco()
    if (uso.nivel !== 'ok') {
      process.stdout.write(`[runner] disco do motor em ${uso.bytes} bytes (nivel ${uso.nivel}) — \`hii disco --limpar\` libera o transitorio\n`)
    }
  })
}

function podar(): void {
  try {
    if (!precisaArquivar()) return
    const r = arquivar()
    for (const m of r.movidos) {
      process.stdout.write(`[runner] #${m.id}: arquivado (${m.status}) — teto de cards por projeto\n`)
    }
  } finally {
    podarTmp()
  }
}

export function tick(verificarMerges: typeof checkMerged = checkMerged): void {
  let ok = true
  const merged = verificarMerges(Date.now()).catch(e => {
    reportTickFailure('checkMerged', e as Error)
    ok = false
  })
  const waking = wakeDueWaiting().catch(e => {
    reportTickFailure('wakeDueWaiting', e as Error)
    ok = false
  })
  try {
    podar()
  } catch (e) {
    reportTickFailure('podar', e as Error)
    ok = false
  }
  try {
    for (const job of pending()) {
      if (quantosEmVoo() >= MAX_CONCURRENCY) break
      void runJob(job)
    }
  } catch (e) {
    reportTickFailure('fila', e as Error)
    ok = false
  }
  void Promise.all([merged, waking]).then(() => { if (ok) recordTickSuccess() })
}

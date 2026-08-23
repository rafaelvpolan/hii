import { isoNow } from '../../cdl'
import type { Job } from '../../cdl'
import { MAX_CONCURRENCY } from '../../cdl/ali/config'
import { patchCard } from '../../cdl/store'
import { pending, marcarEmVoo, liberar, quantosEmVoo } from './estado-da-fila'
import { handleExecute } from '../executar'
import { handleFinish } from '../../qlb/ctr/fechar'
import { handleCorrect } from '../../cic/corrigir'
import { handleSpec } from '../../nmy/luc/fase-spec'
import { checkMerged } from '../../qlb/ctr/merge'
import { arquivar, precisaArquivar } from '../../cdl/arquivar'
import { recordTickSuccess, reportTickFailure } from '../../euc/rdr/tick'
import { wakeDueWaiting } from '../../cic/rpr/espera'
import { limparTmpAntigo, usoDeDisco } from '../../euc/estado-em-disco'
import { podarRegistrosAntigos } from '../../euc/podar'

export { reconcileStranded, pending } from './estado-da-fila'


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

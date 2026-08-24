import { isoNow } from '../../cdl/index.ts'
import type { Job } from '../../cdl/index.ts'
import { MAX_CONCURRENCY } from '../../cdl/ali/config.ts'
import { tetoDeParalelismo } from '../../qlb/limites.ts'
import { patchCard } from '../../cdl/store.ts'
import { pending, marcarEmVoo, liberar, quantosEmVoo } from './estado-da-fila.ts'
import { handleExecute } from '../executar.ts'
import { handleFinish } from '../../qlb/ctr/fechar.ts'
import { handleCorrect } from '../../cic/corrigir.ts'
import { handleSpec } from '../../nmy/luc/fase-spec.ts'
import { checkMerged } from '../../qlb/ctr/merge.ts'
import { arquivar, precisaArquivar } from '../../cdl/arquivar.ts'
import { recordTickSuccess, reportTickFailure } from '../../euc/rdr/tick.ts'
import { wakeDueWaiting } from '../../cic/rpr/espera.ts'
import { limparTmpAntigo, usoDeDisco } from '../../euc/estado-em-disco.ts'
import { podarRegistrosAntigos } from '../../euc/podar.ts'

export { reconcileStranded, pending } from './estado-da-fila.ts'


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
    // Item 32. O teto REAL e o do container; o que o motor pode fazer e nao abrir
    // mais worktrees do que cabem no orcamento que ele recebeu. Antes, limites.ts
    // era calculado e NUNCA lido: o escalonador usava so HICODE_CONCURRENCY, e com
    // os valores do docker-stack.yml (2 cpu, 4096MB, 2048MB por worktree) abria 3
    // worktrees pedindo 6GB contra um limite de 4GB — OOM no cenario que o modulo
    // dizia prevenir. O menor dos dois manda: o operador ainda pode baixar por
    // HICODE_CONCURRENCY, mas nao pode subir acima do que a maquina comporta.
    const teto = tetoDeParalelismo(MAX_CONCURRENCY)
    for (const job of pending()) {
      if (quantosEmVoo() >= teto) break
      void runJob(job)
    }
  } catch (e) {
    reportTickFailure('fila', e as Error)
    ok = false
  }
  void Promise.all([merged, waking]).then(() => { if (ok) recordTickSuccess() })
}

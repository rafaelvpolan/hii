import { isoNow } from '../../cordel/index.ts'
import type { Job } from '../../cordel/index.ts'
import { MAX_CONCURRENCY } from '../../cordel/alicerce/config.ts'
import { tetoDeParalelismo } from '../../quilombo/limites.ts'
import { updateCard } from '../../cordel/store.ts'
import { pending, marcarEmVoo, liberar, quantosEmVoo } from './estado-da-fila.ts'
import { handleExecute } from '../executar.ts'
import { handleFinish } from '../../quilombo/cartorio/fechar.ts'
import { handleCorrect } from '../../ciclo/corrigir.ts'
import { handleSpec } from '../../niemeyer/lucio/fase-spec.ts'
import { checkMerged } from '../../quilombo/cartorio/merge.ts'
import { arquivar, precisaArquivar } from '../../cordel/arquivar.ts'
import { recordTickSuccess, reportTickFailure } from '../../euclides/radar/tick.ts'
import { wakeDueWaiting } from '../../ciclo/reprise/espera.ts'
import { limparTmpAntigo, usoDeDisco } from '../../euclides/estado-em-disco.ts'
import { podarRegistrosAntigos } from '../../euclides/podar.ts'

export { reconcileStranded, pending } from './estado-da-fila.ts'


export async function runJob(job: Job): Promise<void> {
  marcarEmVoo(job.id)
  try {
    if (job.kind === 'execute') await handleExecute(job.id)
    else if (job.kind === 'finish') await handleFinish(job.id)
    else if (job.kind === 'spec') await handleSpec(job.id)
    else await handleCorrect(job.id)
  } catch (e) {
    // `excecao`, nao `terminal`: aqui nao se sabe NADA sobre a causa — e um erro que
    // escapou de todo handler. Chamar isso de terminal seria afirmar que repetir nao
    // resolve, e ninguem mediu isso.
    //
    // `updateCard` e nao `patchCard` porque a etiqueta precisa da ORIGEM REAL, e ela
    // so existe dentro da escrita (`log` recebe o frontmatter de antes). A primeira
    // versao usava `job.kind`, que e 'execute'|'finish'|'correct'|'spec' e nao esta em
    // STATUSES: gravava `execute->HALTED`, narrando transicao a partir de um estado em
    // que o card nunca esteve. E o mesmo defeito que quilombo/cartorio/fechar.ts:149-150
    // ja documenta ter pago uma vez — agravado por `motivoDaParada`
    // (cordel/store.ts), que agora LE esta linha para preencher `halt_reason`.
    // `job.kind` continua na mensagem, onde e informacao, e sai de onde era afirmacao.
    updateCard(job.id, {
      fields: { status: 'HALTED', halt_class: 'excecao' },
      log: fm => `${isoNow()} ${fm.status || 'INBOX'}->HALTED erro nao previsto (${job.kind}): ${String((e as Error)?.message ?? e)}`,
    })
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

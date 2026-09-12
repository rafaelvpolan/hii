import { isoNow } from '../../cordel/index.ts'
import type { Job } from '../../cordel/index.ts'
import { MAX_CONCURRENCY } from '../../cordel/alicerce/config.ts'
import { tetoDeParalelismo } from '../../quilombo/limites.ts'
import { readCard, updateCard } from '../../cordel/store.ts'
import { assinaturaDaFila, pending, marcarEmVoo, liberar, quantosEmVoo, registrarRetornoSemTransicao } from './estado-da-fila.ts'
import { handleExecute } from '../executar.ts'
import { handleFinish } from '../../quilombo/cartorio/fechar.ts'
import { handleCorrect } from '../../ciclo/corrigir.ts'
import { handleSpec } from '../../niemeyer/lucio/fase-spec.ts'
import { checkMerged } from '../../quilombo/cartorio/merge.ts'
import { arquivar, precisaArquivar } from '../../cordel/arquivar.ts'
import { recordTickSuccess, registrarProgressoDoTick, reportTickFailure } from '../../euclides/radar/tick.ts'
import { wakeDueWaiting } from '../../ciclo/reprise/espera.ts'
import { limparTmpAntigo, usoDeDisco } from '../../euclides/estado-em-disco.ts'
import { podarRegistrosAntigos } from '../../euclides/podar.ts'
import { avisarFalhaSilenciosa, motivoDoErro } from '../../cordel/alicerce/aviso.ts'
import { despachoLiberado } from '../../euclides/tesouro/teto-global.ts'

export { reconcileStranded, pending, halteradosDoLote } from './estado-da-fila.ts'


export async function runJob(job: Job): Promise<void> {
  marcarEmVoo(job.id)
  const statusAntes = readCard(job.id)?.fm.status ?? ''
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
      fields: { status: 'HALTED', halt_class: 'excecao', halt_reason: `erro nao previsto (${job.kind}): ${String((e as Error)?.message ?? e).slice(0, 160)}` },
      log: fm => `${isoNow()} ${fm.status || 'INBOX'}->HALTED erro nao previsto (${job.kind}): ${String((e as Error)?.message ?? e)}`,
    })
  } finally {
    const statusDepois = readCard(job.id)?.fm.status ?? ''
    if (statusDepois === statusAntes) registrarRetornoSemTransicao(job.id)
    liberar(job.id)
  }
}

let assinaturaDoTickAnterior = ''

function medirProgressoDaFila(): void {
  const assinatura = assinaturaDaFila()
  const improdutivo = assinatura === assinaturaDoTickAnterior && pending().length > 0 && quantosEmVoo() === 0
  assinaturaDoTickAnterior = assinatura
  registrarProgressoDoTick(improdutivo)
}

function semDerrubarOTick(rotulo: string, consequencia: string, chore: () => void): void {
  try {
    chore()
  } catch (e) {
    avisarFalhaSilenciosa(rotulo, motivoDoErro(e as Error), consequencia)
  }
}

function podarTmp(): void {
  semDerrubarOTick('poda de tmp', 'transitorio antigo deixou de ser removido — disco do motor enchendo em silencio; `hii disco --limpar` alivia', () => {
    const r = limparTmpAntigo()
    if (r.removidos.length) {
      process.stdout.write(`[runner] tmp podado: ${r.removidos.length} item(ns), ${r.bytesLiberados} bytes\n`)
    }
  })
  semDerrubarOTick('poda de registros', 'conversas e ledgers antigos deixaram de ser podados — cards/runs crescendo sem teto', () => {
    const registros = podarRegistrosAntigos()
    if (registros.removidos.length) {
      process.stdout.write(`[runner] registros podados: ${registros.removidos.length} conversa(s)/ledger(s), ${registros.bytesLiberados} bytes\n`)
    }
  })
  semDerrubarOTick('medicao de disco', 'o uso de disco deixou de ser medido — o aviso de disco cheio nao dispara', () => {
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
  try {
    medirProgressoDaFila()
  } catch (e) {
    reportTickFailure('progresso da fila', e as Error)
    ok = false
  }
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
    // era calculado e NUNCA lido: o escalonador usava so HII_CONCURRENCY, e com
    // os valores do docker-stack.yml (2 cpu, 4096MB, 2048MB por worktree) abria 3
    // worktrees pedindo 6GB contra um limite de 4GB — OOM no cenario que o modulo
    // dizia prevenir. O menor dos dois manda: o operador ainda pode baixar por
    // HII_CONCURRENCY, mas nao pode subir acima do que a maquina comporta.
    const teto = tetoDeParalelismo(MAX_CONCURRENCY)
    const global = despachoLiberado()
    if (!global.pode) {
      avisarFalhaSilenciosa('teto global de gasto', global.motivo, 'o despacho esta drenado ate a janela virar; cards novos ficam no disco')
    } else {
      for (const job of pending()) {
        if (quantosEmVoo() >= teto) break
        void runJob(job)
      }
    }
  } catch (e) {
    reportTickFailure('fila', e as Error)
    ok = false
  }
  void Promise.all([merged, waking]).then(() => { if (ok) recordTickSuccess() })
}

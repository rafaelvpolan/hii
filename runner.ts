import { MAX_CONCURRENCY, POLL_MS, RUN_TIMEOUT_MS } from './motor/cordel/alicerce/config.ts'
import { halteradosDoLote, pending, reconcileStranded, runJob, tick } from './motor/oswaldo/mutirao/fila.ts'
import { varrerPreviewsOrfaos } from './motor/ciclo/crivo/url-viva.ts'
import { varrerHarnessesOrfaos } from './motor/tomada/harness-em-voo.ts'
import { renderProgress } from './motor/euclides/radar/progresso.ts'
import { initHicodeHome } from './motor/cordel/alicerce/home.ts'
import { runSync, relatoDeSync } from './motor/tomada/ponte/tarefas/sync.ts'
import { taskSyncName } from './motor/tomada/ponte/tarefas/registro.ts'
import { reportTickFailure } from './motor/euclides/radar/tick.ts'
import { wakeDueWaiting } from './motor/ciclo/reprise/espera.ts'
import { holdInstanceLock, refusalMessage } from './motor/oswaldo/mutirao/trava-instancia.ts'
import { warnProviderConfig } from './motor/tomada/config.ts'
import { instalarShutdownGracioso } from './motor/oswaldo/mutirao/encerramento.ts'
import { retomarAoIniciar } from './motor/euclides/recuperar.ts'
import { validarComandosManuais } from './motor/mirante/comandos-manuais.ts'
import { subirServidorDeSaude } from './motor/euclides/radar/servidor.ts'

process.on('uncaughtException', (e) => {
  reportTickFailure('excecao nao tratada', e)
})
process.on('unhandledRejection', (e) => {
  reportTickFailure('promise rejeitada sem tratamento', e as Error)
})

if (process.argv.includes('--init')) {
  const target = process.argv[process.argv.indexOf('--init') + 1] ?? process.cwd()
  const created = initHicodeHome(target)
  process.stdout.write(created.length ? `.hii/ provisionado em ${target}:\n${created.map(c => `  + ${c}`).join('\n')}\n` : `.hii/ ja existe em ${target}\n`)
  process.exit(0)
} else if (process.argv.includes('--sync')) {
  // `.catch` obrigatorio: sem ele, runSync REJEITANDO caia no handler global de
  // unhandledRejection, o event loop drenava e `--sync` terminava com EXIT 0 e SEM
  // relato — o mesmo "sucesso anunciado sobre trabalho que nao aconteceu" que o
  // exit != 0 abaixo existe para impedir.
  void runSync().then((r) => {
    const relato = relatoDeSync(taskSyncName(), r)
    if (r.ok) { process.stdout.write(`${relato}\n`); process.exit(0) }
    process.stderr.write(`${relato}\n`)
    process.exit(1)
  }).catch((e: Error) => {
    process.stderr.write(`sync (${taskSyncName()}): NAO executou — ${String(e?.message ?? e)}\n`)
    process.exit(1)
  })
} else if (process.argv.includes('--status')) {
  const draw = (): void => { process.stdout.write(`\x1b[2J\x1b[H${renderProgress()}\n`) }
  draw()
  if (process.argv.includes('--watch')) setInterval(draw, 2000)
  else process.exit(0)
} else {
  const lock = holdInstanceLock()
  if (!lock.acquired) {
    process.stderr.write(refusalMessage(lock.holder))
    process.exit(1)
  }
  warnProviderConfig(line => { process.stderr.write(line) })
  // O comentario de comandos-manuais.ts dizia "chamada no arranque e no teste", e
  // so o teste chamava: um atalho de intake apontando para pack inexistente
  // pre-carregaria VAZIO e pareceria que carregou. Aqui a guarda vale de fato.
  // Nao derruba o daemon: reporta e segue, senao um acervo incompleto tira o
  // motor do ar por causa de um atalho.
  try {
    validarComandosManuais()
  } catch (e) {
    process.stderr.write(`[hicode] ${String((e as Error).message)}\n`)
  }
  reconcileStranded()
  try {
    const varrida = varrerPreviewsOrfaos()
    for (const id of varrida.mortosLimpos) process.stdout.write(`[runner] #${id}: url_pid morto limpo no arranque\n`)
    for (const id of varrida.orfaosParados) process.stdout.write(`[runner] #${id}: preview orfao parado no arranque\n`)
  } catch (e) {
    reportTickFailure('varredura de previews', e as Error)
  }
  try {
    const harnesses = varrerHarnessesOrfaos()
    for (const id of harnesses.mortosLimpos) process.stdout.write(`[runner] #${id}: registro de harness morto limpo no arranque\n`)
    for (const h of harnesses.encerrados) process.stdout.write(`[runner] #${h.id}: harness orfao (pid ${h.pid}) encerrado no arranque (${h.sinal})\n`)
    for (const id of harnesses.recusados) process.stdout.write(`[runner] #${id}: registro de harness apontava para processo que nao e harness — descartado sem matar\n`)
    for (const id of harnesses.deixados) process.stdout.write(`[runner] #${id}: harness registrado ainda vivo e o card segue ativo — nao tocado\n`)
  } catch (e) {
    reportTickFailure('varredura de harnesses', e as Error)
  }
  retomarAoIniciar(linha => process.stdout.write(linha))
  if (process.argv.includes('--once')) {
    void wakeDueWaiting()
      .catch((e) => { reportTickFailure('wakeDueWaiting (once)', e as Error) })
      .then(async () => {
        const lote = pending().slice(0, MAX_CONCURRENCY)
        await Promise.all(lote.map(runJob))
        const parados = halteradosDoLote(lote.map(j => j.id))
        if (!parados.length) process.exit(0)
        process.stderr.write(`[runner] --once: ${parados.length} card(s) do lote terminaram em HALTED (#${parados.join(', #')}) — saindo com codigo 1 para o orquestrador ver a falha\n`)
        process.exit(1)
      })
  } else {
    process.stdout.write(`hicode runner ativo — worktrees + paralelo (max ${MAX_CONCURRENCY}, poll ${POLL_MS}ms, timeout ${RUN_TIMEOUT_MS}ms)\n`)
    const saude = subirServidorDeSaude()
    // Espera o `listen` para so anunciar o que de fato subiu: `listen` e assincrono
    // no node, e anunciar antes fazia o log prometer uma porta que podia nunca ter
    // aberto (EADDRINUSE, EACCES).
    if (saude) {
      void saude.pronto.then((porta) => {
        process.stdout.write(porta
          ? `[runner] GET /health em :${porta}\n`
          : '[runner] /health NAO subiu — o motor segue, mas nenhuma sonda externa vai responder\n')
      })
    }
    instalarShutdownGracioso({
      log: linha => process.stdout.write(linha),
      sair: codigo => { saude?.parar(); process.exit(codigo) },
    })
    setInterval(tick, POLL_MS)
    tick()
  }
}

import { MAX_CONCURRENCY, POLL_MS, RUN_TIMEOUT_MS } from './motor/cordel/alicerce/config.ts'
import { pending, reconcileStranded, runJob, tick } from './motor/oswaldo/mutirao/fila.ts'
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
  retomarAoIniciar(linha => process.stdout.write(linha))
  if (process.argv.includes('--once')) {
    void wakeDueWaiting()
      .catch((e) => { reportTickFailure('wakeDueWaiting (once)', e as Error) })
      .then(() => Promise.all(pending().slice(0, MAX_CONCURRENCY).map(runJob)))
      .then(() => process.exit(0))
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

#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProgress } from '../lib/runner/progress'
import { initHicodeHome } from '../lib/runner/hicode-home'
import { installPrePush, uninstallPrePush } from '../lib/runner/hooks'
import { runSync } from '../lib/tasks/sync'
import { taskSyncName } from '../lib/tasks/registry'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON = join(ROOT, 'scripts', 'runner-daemon.sh')
const args = process.argv.slice(2)
const cmd = args[0]

function daemon(sub: string): number {
  return spawnSync(DAEMON, [sub], { stdio: 'inherit' }).status ?? 1
}

function doPainel(comando: string): number {
  process.stderr.write(`"${comando}" e comando do painel, nao do motor — use o hicode.\n`)
  process.stderr.write('o hii executa: start, stop, restart, status, watch, run, once, sync, init, hooks\n')
  return 2
}

function runnerBun(extra: string[]): number {
  return spawnSync('bun', [join(ROOT, 'runner.ts'), ...extra], { stdio: 'inherit', cwd: ROOT }).status ?? 1
}

function usage(): void {
  process.stdout.write([
    'hii — motor de execucao autonoma',
    '',
    'Uso: hii <comando>        o motor executa; quem autora e julga e o painel (hicode)',
    '     hii start            sobe o daemon',
    '',

    'O motor nunca faz merge: ele abre o PR e para.',
    '',
    'Motor (daemon):',
    '  start                    inicia o motor em background (daemon)',
    '  stop                     para o daemon',
    '  restart                  reinicia o daemon',
    '  run                      roda o motor em foreground (nao daemoniza)',
    '  once                     processa a fila uma vez e sai',
    '',
    'Acompanhamento:',
    '  status                   estado do daemon + progresso dos cards',
    '  watch                    progresso dos cards ao vivo (atualiza sozinho)',
    '',
    'Portas humanas do card:',
    '  approve <id>             aprova o preview (PREVIEW -> PREVIEW_OK)',
    '  approve <id> --plan      aprova o plano e enfileira (READY -> EXECUTING)',
    '  reject <id> [o que]      rejeita o preview; com motivo, pede correcao',
    '  halt <id> [motivo]       para o card',
    '',
    'Repo-alvo (deterministico, 0 token):',
    '  repo add <owner/nome>    registra o alvo, valida o clone, provisiona .hii/ e gera o contrato',
    '  repo rm <owner/nome>     remove do registro (nao toca no clone)',
    '  repo ls                  lista os alvos e o estado de cada clone',
    '  contract [caminho]       redetecta o contrato do alvo (stack, comandos, pacotes)',
    '  doctor                   confere gh, IA, daemon, push e contrato de cada alvo',
    '',
    'Arquivo de cards (teto de 10 por projeto):',
    '  board [repo] [--watch]   mostra o board das tarefas no terminal',
    '  teclas                   mostra o que o seu terminal manda em cada tecla',
    '  teclas --corrigir        ensina o Windows Terminal a mandar shift+enter',
    '  rm <id> [id...] --yes    apaga os cards e limpa worktree, preview e runs',
    '  archive                  arquiva os entregues mais antigos acima do teto',
    '  archive --dry-run        mostra o que faria, sem mover',
    '  archive ls               lista o que esta arquivado',
    '  archive restore <id>     traz um card de volta',
    '',
    'Tarefas e integracao:',
    '  sync                     sincroniza tarefas externas (HICODE_TASK_SYNC)',
    '  init [caminho]           provisiona .hii/ num repo-alvo (default: diretorio atual)',
    '  hooks install [caminho]  instala o gate pre-push deterministico (default: atual)',
    '  hooks uninstall [caminho] remove o gate pre-push',
    '',
    'Ajuda:',
    '  --help, -h, ajuda        mostra esta ajuda',
    '',
    'Fluxo de um card: executar -> preview (link vivo) -> aprovar -> polir -> PR.',
    'Merge e SEMPRE humano: o motor para em PR_OPEN e nunca da merge.',
    '',
  ].join('\n'))
}

function hooks(): number {
  const sub = args[1]
  const repo = args[2] || process.cwd()
  const source = join(ROOT, 'scripts', 'hooks', 'pre-push')
  if (sub === 'install') {
    const dest = installPrePush(repo, source)
    process.stdout.write(dest ? `pre-push instalado: ${dest}\n` : `falha ao instalar (repo git valido? hook fonte existe?)\n`)
    return dest ? 0 : 1
  }
  if (sub === 'uninstall') {
    const ok = uninstallPrePush(repo)
    process.stdout.write(ok ? `pre-push removido de ${repo}\n` : `nenhum pre-push encontrado em ${repo}\n`)
    return 0
  }
  process.stdout.write('uso: hii hooks <install|uninstall> [caminho]\n')
  return 1
}

async function main(): Promise<number> {
  switch (cmd) {
    case 'help':
    case 'ajuda':
    case '--help':
    case '-h':
      usage()
      return 0
    case 'start':
    case 'stop':
    case 'restart':
      return daemon(cmd)
    case 'status':
      daemon('status')
      process.stdout.write(`\n${renderProgress()}\n`)
      return 0
    case 'watch': {
      const draw = (): void => { process.stdout.write(`\x1b[2J\x1b[H${renderProgress()}\n`) }
      draw()
      setInterval(draw, 2000)
      return -1
    }
    case 'run':
      return runnerBun([])
    case 'once':
      return runnerBun(['--once'])
    case 'sync': {
      const r = await runSync()
      process.stdout.write(`sync (${taskSyncName()}): ${r.created} cards criados, ${r.pushed} espelhados de ${r.pulled} externos\n`)
      return 0
    }
    case 'init': {
      const target = args[1] || process.cwd()
      const created = initHicodeHome(target)
      process.stdout.write(created.length ? `.hii/ provisionado em ${target}:\n${created.map(c => `  + ${c}`).join('\n')}\n` : `.hii/ ja existe em ${target}\n`)
      return 0
    }
    case 'hooks':
      return hooks()
    case 'repo':
    case 'approve':
    case 'reject':
    case 'halt':
    case 'contract':
    case 'doctor':
    case 'teclas':
    case 'board':
    case 'quadro':
    case 'rm':
    case 'apagar':
    case 'archive':
      return doPainel(String(args[0]))
    case undefined:
      usage()
      return 0
    default:
      usage()
      return 1
  }
}

const code = await main()
if (code >= 0) process.exit(code)

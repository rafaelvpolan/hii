#!/usr/bin/env node
// Shebang em `node`, nao em `bun`, e o mesmo motivo da Onda 11: a imagem de
// producao e node:24-slim (Dockerfile: ENTRYPOINT ["node", "bin/hii.ts"]), e o
// node 24 roda este arquivo por type stripping nativo. Um shebang `bun` fazia o
// bin instalado exigir um binario que a imagem nao tem — a mesma promessa de
// "roda em qualquer lugar" que motor/cordel/alicerce/runtime.ts existe para cumprir.
// Quem prefere bun continua rodando `bun bin/hii.ts` (o shebang nao atrapalha).
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProgress } from '../motor/euclides/radar/progresso.ts'
import { initHicodeHome } from '../motor/cordel/alicerce/home.ts'
import { installPrePush, uninstallPrePush } from '../motor/cordel/alicerce/hooks.ts'
import { runSync, relatoDeSync } from '../motor/tomada/ponte/tarefas/sync.ts'
import { taskSyncName } from '../motor/tomada/ponte/tarefas/registro.ts'
import { limparTmpAntigo, usoDeDisco } from '../motor/euclides/estado-em-disco.ts'
import { linhasDoDisco } from '../motor/mirante/render/disco.ts'
import { snapshotDoMotor, revisaoDoEstado } from '../motor/mirante/estado-json.ts'
import { executarAcao, criarTarefa } from '../motor/mirante/comandos-de-tarefa.ts'
import type { AcaoDeTarefa } from '../motor/mirante/comandos-de-tarefa.ts'
import { prepararMatriz } from '../motor/quilombo/cartorio/aprovar-plano.ts'
import { pedirPassoManual, pedirSuiteManual } from '../motor/quilombo/cartorio/passos-manuais.ts'
import { runtimeDeScript } from '../motor/cordel/alicerce/runtime.ts'
import { ajudaDeComandosManuais } from '../motor/mirante/comandos-manuais.ts'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON = join(ROOT, 'scripts', 'runner-daemon.sh')
const args = process.argv.slice(2)
const cmd = args[0]

function daemon(sub: string): number {
  return spawnSync(DAEMON, [sub], { stdio: 'inherit' }).status ?? 1
}

function semBoard(): number {
  process.stderr.write('o board saiu do terminal — navegar cards e do painel web (hicode)\n')
  process.stderr.write('no terminal: hii (abre a TUI) para trabalhar, hii watch para acompanhar\n')
  return 2
}

function script(name: string, extra: string[]): number {
  return spawnSync(runtimeDeScript(), [join(ROOT, 'scripts', 'setup', `${name}.mjs`), ...extra], { stdio: 'inherit', cwd: ROOT }).status ?? 1
}

function runnerBun(extra: string[]): number {
  return spawnSync(runtimeDeScript(), [join(ROOT, 'runner.ts'), ...extra], { stdio: 'inherit', cwd: ROOT }).status ?? 1
}

function disco(extra: string[]): number {
  const limpar = extra.includes('--limpar')
  if (limpar) {
    const r = limparTmpAntigo(0)
    process.stdout.write(`transitorio limpo: ${r.removidos.length} item(ns), ${r.bytesLiberados} bytes liberados\n`)
  }
  const uso = usoDeDisco()
  process.stdout.write(`${linhasDoDisco(uso, { color: process.stdout.isTTY === true }).join('\n')}\n`)
  return uso.nivel === 'teto' ? 1 : 0
}

function valorDaFlag(extra: string[], flag: string): string {
  const i = extra.indexOf(flag)
  return i >= 0 ? (extra[i + 1] ?? '') : ''
}

function estado(extra: string[]): number {
  if (extra.includes('--revisao')) {
    process.stdout.write(`${revisaoDoEstado()}\n`)
    return 0
  }
  // `--json` estava no usage() e nunca era lido: a saida SEMPRE foi JSON, entao a
  // flag era decorativa. Aceita-la explicitamente (como no-op documentado) e mais
  // honesto que anunciar uma flag que o codigo ignora — quem a passa recebe o que
  // pediu, e `--compacto` continua sendo o unico que muda a forma.
  const snapshot = snapshotDoMotor({ repo: valorDaFlag(extra, '--repo') })
  const espacos = extra.includes('--compacto') ? 0 : 2
  process.stdout.write(`${JSON.stringify(snapshot, null, espacos)}\n`)
  return 0
}

// A mensagem de uso tem de citar o COMANDO que o humano digita, nao o nome da acao
// interna: `hii approve` sem id respondia "uso: hii aprovar-url <id>", e
// `aprovar-url` nao existe no switch — a ajuda mandava rodar comando inexistente.
const COMANDO_DA_ACAO: Record<AcaoDeTarefa, string> = {
  'aprovar-url': 'approve',
  'aprovar-plano': 'approve --plan',
  recusar: 'reject',
  parar: 'halt',
  responder: 'answer',
  criar: 'tarefa nova',
}

function semIdDeTarefa(acao: AcaoDeTarefa): number {
  process.stderr.write(`uso: hii ${COMANDO_DA_ACAO[acao]} <id> [texto] [--json]\n`)
  return 2
}

function tarefa(acao: AcaoDeTarefa, extra: string[]): number {
  const argumentos = extra.filter(a => !a.startsWith('--'))
  const id = argumentos[0] ?? ''
  if (!id) return semIdDeTarefa(acao)
  const r = executarAcao(acao, id, argumentos.slice(1).join(' '))
  if (extra.includes('--json')) process.stdout.write(`${JSON.stringify(r)}\n`)
  else process.stdout.write(`${r.mensagem}\n`)
  return r.ok ? 0 : 1
}

async function matriz(extra: string[]): Promise<number> {
  const id = extra.filter(a => !a.startsWith('--'))[0] ?? ''
  if (!id) {
    process.stderr.write('uso: hii matriz <id>\n')
    return 2
  }
  const r = await prepararMatriz(id)
  if (!r.ok) {
    process.stderr.write(`${r.relato}\n`)
    return 1
  }
  process.stdout.write(`${r.caminho}\n${r.relato}\n`)
  return r.parede.satisfeito ? 0 : 1
}

function passoPipeline(extra: string[]): number {
  const [id, passo] = extra.filter(a => !a.startsWith('--'))
  if (!id || !passo) {
    process.stderr.write('uso: hii passo <id> <arquitetura|polimento|testes|seguranca|limpeza>\n')
    return 2
  }
  const r = pedirPassoManual(id, passo)
  process[r.ok ? 'stdout' : 'stderr'].write(`${r.mensagem}\n`)
  return r.ok ? 0 : 1
}

function suitePipeline(extra: string[]): number {
  const id = extra.filter(a => !a.startsWith('--'))[0] ?? ''
  if (!id) {
    process.stderr.write('uso: hii pipeline <id>\n')
    return 2
  }
  const r = pedirSuiteManual(id)
  process[r.ok ? 'stdout' : 'stderr'].write(`${r.mensagem}\n`)
  return r.ok ? 0 : 1
}

async function tarefaNova(extra: string[]): Promise<number> {
  const repo = valorDaFlag(extra, '--repo')
  const texto = extra.filter(a => !a.startsWith('--') && a !== repo).join(' ')
  const r = criarTarefa(texto, repo)
  const paredeSegurou = r.motivo === 'parede'
  const preparada = paredeSegurou ? await prepararMatriz(r.id) : null
  if (extra.includes('--json')) process.stdout.write(`${JSON.stringify({ ...r, matriz: preparada?.caminho ?? '' })}\n`)
  else {
    process.stdout.write(`${r.mensagem}\n`)
    if (preparada?.ok) process.stdout.write(`responda a matriz e aprove: ${preparada.caminho}\n`)
  }
  return r.ok ? 0 : 1
}

async function comandoDeTarefa(extra: string[]): Promise<number> {
  const sub = extra[0] ?? ''
  if (sub === 'nova' || sub === 'new') return tarefaNova(extra.slice(1))
  process.stderr.write('uso: hii tarefa nova "<o que mudar>" --repo <owner/nome> [--json]\n')
  return 2
}

function usage(): void {
  process.stdout.write([
    'hii — motor de execucao autonoma',
    '',
    'Uso: hii                  abre a TUI (escrever card, aprovar, acompanhar)',
    '     hii start            sobe o daemon',
    '     hii disco [--limpar] uso de disco do estado (refs, tmp, urls, runs)',
    '     hii estado [--compacto]  snapshot do motor em JSON (para o painel); --revisao so o token',
    '     hii responder <id> <texto>   responde a pergunta aberta da tarefa',
    '     hii tarefa nova "<texto>" --repo <owner/nome>  cria a tarefa e enfileira',
    '',
    '  atalhos de intake (na TUI; pre-carregam conhecimento do dominio):',
    ...ajudaDeComandosManuais(),
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
    '  board, quadro            saiu do terminal — os cards se navegam pelo painel web',
    '',
    'Portas humanas do card:',
    '  tarefa nova "<t>" --repo <owner/nome> [--json]   cria a tarefa e ja enfileira',
    '  matriz <id>              cria/confere a matriz de entendimento do card (Pilar 1)',
    '  approve <id>             aprova a url entregue (URL -> URL_OK)',
    '  approve <id> --plan      aprova o plano e enfileira (READY -> EXECUTING)',
    '  reject <id> [o que]      rejeita; com motivo, pede correcao',
    '  halt <id> [motivo]       para o card',
    '',
    'Pipeline manual (padrao apos aprovar a url — HICODE_PIPELINE=auto volta ao sequencial):',
    '  passo <id> <passo>       roda um passo do pipeline e pausa: arquitetura (apelido: polimento),',
    '                           testes, seguranca, limpeza',
    '  pipeline <id>            roda o restante de uma vez e segue para build, gates e PR',
    '',
    'Repo-alvo (deterministico, 0 token) — "project" e sinonimo de "repo":',
    '  repo add <owner/nome>    registra o alvo, valida o clone, provisiona .hii/',
    '  repo rm <owner/nome>     remove do registro (o clone local nao e tocado)',
    '  repo ls                  lista os alvos registrados e o estado do clone',
    '  contract [caminho]       redetecta o contrato do alvo (stack, comandos)',
    '  doctor                   confere gh, IA, daemon, push e contrato',
    '',
    'Arquivo de cards:',
    '  rm <id> [id...] --yes    apaga cards e limpa worktree, url e runs',
    '  archive [--dry-run|ls|restore <id>]',
    '  teclas [--corrigir]      diagnostica/ensina shift+enter no terminal',
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
    'Fluxo de um card: executar -> url (link vivo) -> aprovar -> polir -> PR.',
    'Merge e SEMPRE humano: o motor para em PR_OPEN e nunca da merge.',
    '',
  ].join('\n'))
}

function hooks(): number {
  const sub = args[1]
  const repo = args[2] || process.cwd()
  const source = join(ROOT, 'scripts', 'hooks', 'pre-push')
  if (sub === 'install') {
    const r = installPrePush(repo, source)
    if (!r.ok) {
      process.stderr.write(`falha ao instalar: ${r.motivo}\n`)
      return 1
    }
    process.stdout.write(`pre-push instalado: ${r.caminho}\n`)
    if (r.backup) process.stdout.write(`  o pre-push que ja existia foi guardado em ${r.backup}\n`)
    return 0
  }
  if (sub === 'uninstall') {
    const r = uninstallPrePush(repo, source)
    if (!r.ok) {
      process.stderr.write(`${r.motivo}\n`)
      return 1
    }
    process.stdout.write(`pre-push removido de ${repo}\n`)
    if (r.restaurado) process.stdout.write(`  o pre-push anterior foi restaurado em ${r.restaurado}\n`)
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
      const r = await runSync().catch((e: Error) => {
        process.stderr.write(`sync (${taskSyncName()}): NAO executou — ${String(e?.message ?? e)}\n`)
        return null
      })
      if (!r) return 1
      const relato = relatoDeSync(taskSyncName(), r)
      if (r.ok) { process.stdout.write(`${relato}\n`); return 0 }
      // Exit != 0: quem chama `hii sync` de um cron ou de um workflow le o codigo
      // de saida, nao o texto. Sair 0 apos falhar em falar com o GitHub fazia o
      // pipeline seguir como se tivesse espelhado.
      process.stderr.write(`${relato}\n`)
      return 1
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
    case 'project':
      return script('repo', args.slice(1))
    case 'matriz':
      return matriz(args.slice(1))
    case 'passo':
    case 'step':
      return passoPipeline(args.slice(1))
    case 'pipeline':
      return suitePipeline(args.slice(1))
    case 'approve':
    case 'aprovar':
      return tarefa(args.includes('--plan') || args.includes('--plano') ? 'aprovar-plano' : 'aprovar-url', args.slice(1))
    case 'reject':
    case 'recusar':
      return tarefa('recusar', args.slice(1))
    case 'halt':
    case 'parar':
      return tarefa('parar', args.slice(1))
    case 'answer':
    case 'responder':
      return tarefa('responder', args.slice(1))
    case 'tarefa':
    case 'task':
      return comandoDeTarefa(args.slice(1))
    case 'estado':
    case 'state':
      return estado(args.slice(1))
    case 'contract':
      return script('contract', args.slice(1))
    case 'doctor':
      return script('doctor', args.slice(1))
    case 'teclas':
      return args[1] === '--corrigir'
        ? script('wt-shift-enter', args.slice(2))
        : script('teclas', args.slice(1))
    case 'rm':
    case 'apagar':
      return script('rm', args.slice(1))
    case 'archive':
      return script('archive', args.slice(1))
    case 'disco':
      return disco(args.slice(1))
    case 'board':
    case 'quadro':
      return semBoard()
    case undefined:
      return spawnSync(runtimeDeScript(), [join(ROOT, 'bin', 'repl.ts')], { stdio: 'inherit', cwd: ROOT }).status ?? 0
    default:
      usage()
      return 1
  }
}

const code = await main()
if (code >= 0) process.exit(code)

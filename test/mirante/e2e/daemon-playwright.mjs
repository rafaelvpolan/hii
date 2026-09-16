import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { ambienteDaemon } from './daemon-ambiente.mjs'
import { gravarRelatorio } from './relatorio.ts'

const destination = resolve(process.argv[2] || '/tmp/hii-daemon-e2e')
mkdirSync(destination, { recursive: true })
const fixture = ambienteDaemon()
const { base, env, cli } = fixture
const quote = text => `'${text.replaceAll("'", "'\\''")}'`
const captures = []
const manifesto = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtime: `node ${process.version}`, etapa: 'arranque', resultado: 'executando', colunas: 100, linhas: 36 }
gravarRelatorio(destination, captures, manifesto)
const children = new Set()
let browser, context
let daemon, daemonLog = '', tui, page, pump = Promise.resolve(), ansi = '', failure
const screenErrors = []
const until = async (predicate, description, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  throw Error(`timeout: ${description}`)
}
function child(command, args, opts) {
  const process = spawn(command, args, { env, detached: true, ...opts })
  children.add(process)
  process.done = new Promise((resolve, reject) => {
    process.once('error', reject)
    process.once('close', code => { children.delete(process); resolve(code) })
  })
  return process
}
const state = () => JSON.parse(cli('estado', '--compacto'))
async function startDaemon() {
  daemon = child(process.execPath, [resolve('runner.ts')], { cwd: join(base, 'engine'), stdio: ['ignore', 'pipe', 'pipe'] })
  for (const output of [daemon.stdout, daemon.stderr]) output.on('data', chunk => { daemonLog += chunk })
  // Explicitly register only this owned child; never discover or signal the user's daemon.
  writeFileSync(env.HII_RUNNER_PIDFILE, String(daemon.pid))
  writeFileSync(`${env.HII_RUNNER_PIDFILE}.root`, join(base, 'engine'))
  await until(() => state().daemon.vivo, 'daemon privado online')
}
async function stopDaemon() {
  const current = daemon
  current.kill('SIGTERM')
  const code = await Promise.race([current.done, new Promise((_, reject) => {
    const timeout = setTimeout(() => reject(Error('daemon nao encerrou')), 8000); timeout.unref()
  })])
  daemon = undefined
  return code
}
async function openTui() {
  page = await context.newPage()
  page.on('pageerror', error => screenErrors.push(error.message))
  await page.setContent('<html><meta charset="utf-8"><style>body{background:#101716}#terminal{display:inline-block}</style><div id="terminal"></div></html>')
  await page.addStyleTag({ path: resolve('node_modules/@xterm/xterm/css/xterm.css') })
  await page.addScriptTag({ path: resolve('node_modules/@xterm/xterm/lib/xterm.js') })
  await page.exposeFunction('inputPty', data => tui.stdin.write(data))
  await page.evaluate(() => {
    window.term = new window.Terminal({ cols: 100, rows: 36, fontSize: 12, allowProposedApi: true })
    term.open(document.querySelector('#terminal'))
    term.onData(data => window.inputPty(data))
    window.screenText = () => Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(term.buffer.active.viewportY + i)?.translateToString(true) || '').join('\n')
    term.focus()
  })
  const currentPage = page
  tui = child(join(base, 'bin/script'), ['-qefc', `stty cols 100 rows 36; exec ${quote(process.execPath)} ${quote(resolve('bin/hii.ts'))}`, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] })
  for (const output of [tui.stdout, tui.stderr]) output.on('data', chunk => {
    const text = chunk.toString(); ansi += text
    pump = pump.then(() => currentPage.evaluate(text => new Promise(resolve => term.write(text, resolve)), text))
  })
  await see('projeto›')
  await command('1')
  await see('e2e/app')
}
const see = text => page.waitForFunction(text => window.screenText().includes(text), text, { timeout: 15000 })
async function command(text) {
  await page.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}
async function capture(name) {
  manifesto.etapa = name
  await pump
  const text = await page.evaluate(() => screenText())
  const png = await page.locator('#terminal').screenshot({ path: join(destination, `${name}.png`) })
  writeFileSync(join(destination, `${name}.txt`), text)
  captures.push({ nome: name, colunas: 100, linhas: 36, texto: text, imagem: `data:image/png;base64,${png.toString('base64')}` })
  gravarRelatorio(destination, captures, manifesto)
}
async function closeTui() {
  await command('/exit')
  const result = await Promise.race([tui.done, new Promise((_, reject) => { const t = setTimeout(() => reject(Error('TUI nao encerrou')), 8000); t.unref() })])
  assert.equal(result, 0)
  assert.ok(ansi.includes('\x1b[?1049l') && ansi.includes('\x1b[?2004l'), 'saida restaura tela e bracketed paste')
  await pump
  await page.close()
}
try {
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1365, height: 900 } })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
  await openTui()
  assert.ok(ansi.includes('daemon offline'), 'entrypoint deve executar preflight e anunciar daemon offline')
  await command('/new conversa daemon real')
  await see('conversa daemon real')
  await command('Preserve a API publica')
  await see('offline')
  const offline = state()
  assert.equal(offline.daemon.vivo, false)
  assert.equal(offline.conversas.length, 1)
  const conversation = offline.conversas[0].id
  assert.equal(offline.conversas[0].execucoes.length, 1)
  const execution = offline.conversas[0].execucoes[0].id
  assert.equal(offline.tarefas.find(task => task.id === execution).status, 'EXECUTING')
  await capture('daemon-offline')
  await startDaemon()
  await see('EXECUCAO_REAL_INICIADA')
  await capture('daemon-executando')
  await closeTui()
  assert.equal(state().daemon.vivo, true, 'fechar TUI nao deve interromper daemon')
  assert.equal(await stopDaemon(), 1, 'interromper trabalho informa drenagem incompleta')
  assert.equal(state().daemon.vivo, false)
  await startDaemon()
  await openTui()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await see('RETOMADA_REAL_CONFIRMADA')
  await capture('daemon-reconectado')
  writeFileSync(join(base, 'liberar-fim'), '')
  await see('RESULTADO_REAL_UNICO')
  await see('nada em execucao')
  await until(() => state().tarefas.find(task => task.id === execution).status === 'COMPLETED', 'conclusao publicada')
  const finished = state()
  writeFileSync(join(destination, 'daemon-estado-final.json'), JSON.stringify(finished, null, 2))
  const session = finished.conversas.find(item => item.id === conversation)
  assert.equal(session.execucoes.length, 1, 'reinicio nao cria execucao duplicada')
  assert.equal(session.mensagens.filter(item => item.autor === 'humano' && item.texto.includes('Preserve a API publica')).length, 1)
  assert.equal(session.mensagens.filter(item => item.autor === 'ia' && item.texto.includes('RESULTADO_REAL_UNICO')).length, 1)
  assert.ok(session.subsessoes.every(item => item.estado !== 'executando'), 'nenhuma subsessao fica presa no spinner')
  const calls = readFileSync(join(base, 'chamadas.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(calls.length, 2, 'exatamente uma tentativa antes e uma depois do reinicio')
  assert.deepEqual(calls.map(item => item.retomou), [false, true])
  for (const call of calls) assert.throws(() => process.kill(call.pid, 0), { code: 'ESRCH' }, 'harness anterior foi encerrado e tentativa final terminou')
  assert.ok(calls.every(item => item.cwd === join(base, 'alvo')))
  assert.equal(readFileSync(join(base, 'alvo/parcial.txt'), 'utf8'), 'trabalho preservado')
  await capture('daemon-concluido')
  await closeTui()
  await openTui()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await see('RESULTADO_REAL_UNICO')
  await see('nada em execucao')
  await capture('daemon-conclusao-persistida')
  assert.equal(state().conversas[0].execucoes.length, 1)
  // Real public commands populate a history longer than the available viewport.
  for (let index = 1; index <= 36; index++) {
    await command(`/new sessao extensa ${String(index).padStart(2, '0')}`)
    await see(`sessao extensa ${String(index).padStart(2, '0')}`)
  }
  await command('/historico')
  await page.keyboard.press('ArrowLeft')
  for (let index = 0; index < 36; index++) await page.keyboard.press('ArrowDown')
  await see(`> #${conversation} `)
  await capture('historico-extenso-selecao-antiga')
  await page.keyboard.press('Enter')
  await see('RESULTADO_REAL_UNICO')
  await command('/repo')
  await see('digite o numero ou o nome do projeto')
  await capture('projetos-lista-extensa')
  await command('24')
  await see('projeto e2e/projeto-22')
  await command('/repo e2e/outro')
  await command('/new conversa exclusiva outro')
  await see('conversa exclusiva outro')
  await command('/historico')
  await page.keyboard.press('ArrowLeft')
  await see('conversa exclusiva outro')
  const otherHistory = await page.evaluate(() => screenText())
  assert.ok(!otherHistory.includes('sessao extensa') && !otherHistory.includes('conversa daemon real'), 'historico filtrado pelo projeto selecionado')
  await capture('historico-projeto-isolado')
  await command('/repo e2e/app')
  await command('/historico')
  await page.keyboard.press('ArrowLeft')
  await see('sessao extensa 36')
  assert.ok(!(await page.evaluate(() => screenText())).includes('conversa exclusiva outro'))
  const extensive = state()
  assert.equal(extensive.conversas.filter(item => item.repo === 'e2e/app').length, 37)
  assert.equal(extensive.conversas.filter(item => item.repo === 'e2e/outro').length, 1)
  assert.equal(extensive.conversas.reduce((total, item) => total + item.execucoes.length, 0), 1, 'navegacao e /new nao criam execucoes extras')
  await closeTui()
  assert.equal(await stopDaemon(), 0, 'daemon sem trabalho encerra limpo')
  assert.equal(readFileSync(join(base, 'chamadas.jsonl'), 'utf8').trim().split('\n').length, 2, 'reconectar apos conclusao nao chama IA novamente')
  assert.deepEqual(screenErrors, [])
  console.log('entrypoint/preflight/projeto + daemon real: offline, reinicio, reconexao, conclusao sem duplicacao OK')
} catch (error) {
  failure = error
  manifesto.resultado = 'falha'
  manifesto.erro = error.stack
  writeFileSync(join(destination, 'daemon-estado-falha.json'), cli('estado', '--compacto'))
  if (page && !page.isClosed()) await capture('daemon-falha').catch(() => {})
} finally {
  writeFileSync(join(base, 'liberar-fim'), '')
  for (const process of children) { try { process.kill('SIGTERM') } catch {} }
  await new Promise(resolve => setTimeout(resolve, 300))
  for (const process of children) { try { globalThis.process.kill(-process.pid, 'SIGKILL') } catch {} }
  await Promise.allSettled([...children].map(process => process.done))
  await pump.catch(() => {})
  manifesto.resultado = failure ? 'falha' : 'aprovado'
  gravarRelatorio(destination, captures, manifesto)
  writeFileSync(join(destination, 'daemon-terminal.ansi'), ansi)
  writeFileSync(join(destination, 'daemon.log'), daemonLog)
  writeFileSync(join(destination, 'daemon-capturas.json'), JSON.stringify({ versao: 1, origem: 'entrypoint e daemon reais, CLI Codex hermetico', falha: failure?.stack || '', capturas: captures }))
  if (context) await context.tracing.stop({ path: join(destination, 'daemon-trace.zip') })
  await browser?.close()
  rmSync(base, { recursive: true, force: true })
}
if (failure) throw failure

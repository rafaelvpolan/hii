import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { ambienteTui } from './ambiente-tui.ts'
import { allCards, patchCard, readCard } from '../../../motor/cordel/store.ts'
import { lerSessaoHii, fecharSessaoHii } from '../../../motor/euclides/sessoes.ts'
import { writeClarify, readClarify } from '../../../motor/agentes/clarice/clarificar.ts'
import { modoFor } from '../../../motor/tomada/registro.ts'

const destino = resolve(process.argv[2] || '/tmp/hii-tui-visual')
mkdirSync(destino, { recursive: true })
const browser = await chromium.launch({ headless: true })
const capturas = []
const quote = s => `'${s.replaceAll("'", "'\\''")}'`
try {
  for (const [cols, width] of [[48, 390], [100, 1365]]) {
    const env = { ...process.env }
    const base = mkdtempSync(join(tmpdir(), 'hii-tui-e2e-'))
    ambienteTui(base)
    writeFileSync(join(base, 'ambiente-e2e'), '')
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const page = await context.newPage()
    const erros = []
    page.on('pageerror', e => erros.push(e.message))
    let filho, terminado = false, codigo, sinal, textoAnsi = ''
    let fim = Promise.resolve()
    let bomba = Promise.resolve()
    try {
      await page.setContent('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>HII TUI E2E</title><style>html,body{margin:0;background:#101716}#terminal{padding:12px;display:inline-block}</style><main id="terminal" aria-label="Terminal HII"></main></html>')
      await page.addStyleTag({ path: resolve('node_modules/@xterm/xterm/css/xterm.css') })
      await page.addScriptTag({ path: resolve('node_modules/@xterm/xterm/lib/xterm.js') })
      await page.exposeFunction('entradaPty', texto => { if (!terminado) filho?.stdin.write(texto) })
      await page.evaluate(cols => {
        const term = new window.Terminal({ cols, rows: 36, fontSize: 12, fontFamily: 'monospace', cursorBlink: false,
          theme: { background: '#101716', foreground: '#e0e8e4' }, allowProposedApi: true })
        term.open(document.getElementById('terminal'))
        term.onData(data => window.entradaPty(data))
        term.focus()
        window.term = term
        window.tela = () => Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(term.buffer.active.viewportY + i)?.translateToString(true) || '').join('\n')
      }, cols)
      filho = spawn('script', ['-qefc', `stty cols ${cols} rows 36; exec ${quote(process.execPath)} ${quote(resolve('test/mirante/e2e/tui-filho.ts'))} ${quote(base)}`, '/dev/null'], {
        env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      })
      fim = new Promise((res, rej) => {
        filho.once('error', rej)
        filho.once('close', (code, signal) => { terminado = true; codigo = code; sinal = signal; res() })
      })
      filho.stdout.setEncoding('utf8')
      filho.stderr.setEncoding('utf8')
      const encaminhar = data => {
        textoAnsi += data
        bomba = bomba.then(() => page.evaluate(data => new Promise(res => window.term.write(data, res)), data)).catch(e => { erros.push(e.message) })
      }
      filho.stdout.on('data', encaminhar)
      filho.stderr.on('data', encaminhar)
      const ver = texto => page.waitForFunction(texto => window.tela().includes(texto), texto, { timeout: 12000 })
      const comando = async texto => {
        await page.locator('.xterm-helper-textarea').focus()
        await page.keyboard.type(texto)
        await page.keyboard.press('Enter')
      }
      const capturar = async nome => {
        await bomba
        await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))))
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${nome}/${cols}`)
        const texto = await page.evaluate(() => window.tela())
        assert.ok(texto.trim().length > 50, `tela vazia: ${nome}`)
        assert.ok(!texto.includes('error()'), `erro sem descricao: ${nome}`)
        const arquivo = `${cols}-${String(capturas.length + 1).padStart(2, '0')}-${nome}.png`
        const png = await page.locator('#terminal').screenshot({ path: join(destino, arquivo) })
        writeFileSync(join(destino, arquivo.replace('.png', '.txt')), texto)
        capturas.push({ nome, colunas: cols, linhas: 36, texto, imagem: `data:image/png;base64,${png.toString('base64')}` })
      }
      await ver('nada em execucao')
      await capturar('inicio')
      await comando('/new conversa E2E')
      await ver('conversa E2E')
      const sessao = allCards().find(c => c.tipo === 'session').id
      await comando('Preserve a API publica')
      await ver('Codex iniciou o trabalho')
      const id = lerSessaoHii(sessao).execucoes[0].id
      assert.equal(readCard(id).fm.status, 'EXECUTING')
      await capturar('streaming-codex')
      writeFileSync(join(base, 'alvo', 'liberar-cota'), '')
      await ver('mudando automaticamente para claude')
      await ver('Claude continuou o trabalho')
      const tela = await page.evaluate(() => window.tela())
      assert.ok(tela.includes('IA codex falhou'))
      assert.ok(tela.indexOf('IA codex falhou') < tela.indexOf('mudando automaticamente'))
      await capturar('falha-e-troca')
      writeFileSync(join(base, 'alvo', 'liberar-fim'), '')
      await ver('concluido')
      await ver('nada em execucao')
      assert.equal(readCard(id).fm.status, 'COMPLETED')
      assert.deepEqual(lerSessaoHii(sessao).subsessoes.map(s => s.provedor), ['codex', 'claude'])
      await capturar('concluido')
      await comando('/ask qual o resultado?')
      await ver('consulta somente leitura no E2E')
      assert.equal(lerSessaoHii(sessao).execucoes.length, 1)
      await capturar('ask')
      await comando('Ajuste a interface')
      await ver('Ajuste a interface')
      const pendente = lerSessaoHii(sessao).execucoes[1].id
      writeClarify(pendente, [{ q: 'Qual cor aplicar?', options: ['azul', 'verde'], recommended: 'azul' }])
      patchCard(pendente, { status: 'CLARIFY' })
      await ver('Qual cor aplicar?')
      await capturar('pergunta')
      await page.keyboard.press('2')
      await ver('retomad')
      assert.equal(readClarify(pendente)[0].answer, 'verde')
      await page.keyboard.press('Control+c')
      await ver('retoma')
      assert.equal(readCard(pendente).fm.status, 'HALTED')
      await capturar('interrompido')
      await page.keyboard.press('Enter')
      await ver('retomad')
      assert.equal(readCard(pendente).fm.status, 'EXECUTING')
      for (const status of ['URL', 'URL_OK', 'CONFIRM']) patchCard(pendente, { status, verify: 'sem-url' })
      await ver('encerrar e abrir o PR')
      await capturar('confirmacao')
      await page.keyboard.press('1')
      await ver('encerrado')
      assert.equal(readCard(pendente).fm.fecho_confirmado, 'sim')
      patchCard(pendente, { status: 'HALTED', halt_class: 'humano' })
      fecharSessaoHii(sessao)
      await comando('/historico')
      await ver(`#${sessao} closed`)
      await capturar('session-closed')
      await comando('/new configuracoes')
      await ver('configuracoes')
      await comando('/model')
      await ver('modelo-teste')
      await capturar('modelos')
      await comando('/ia')
      await ver('/ia claude')
      for (let i = 0; i < 6 && !(await page.evaluate(() => /\[(ok|cota|sem-cli)\]/.test(window.tela()))); i++) {
        await page.keyboard.press('PageUp')
        await bomba
      }
      await page.waitForFunction(() => /\[(ok|cota|sem-cli)\]/.test(window.tela()))
      await capturar('ias')
      await page.keyboard.press('Shift+Tab')
      await ver('codex: modo on-request')
      assert.equal(modoFor('implement'), 'on-request')
      await comando('/config')
      await ver('IAS')
      await page.keyboard.press('ArrowDown')
      await ver('CODEX')
      await ver('on-request')
      await capturar('config')
      await page.keyboard.press('Escape')
      await comando('/exit')
      await Promise.race([fim, new Promise((_, rej) => { const t = setTimeout(() => rej(Error('TUI nao encerrou')), 8000); t.unref() })])
      await bomba
      assert.equal(codigo, 0, `signal=${sinal}`)
      assert.ok(textoAnsi.includes('\x1b[?1049l') && textoAnsi.includes('\x1b[?2004l'))
      assert.deepEqual(erros, [])
      console.log(`${cols}x36: teclado Playwright -> xterm -> PTY -> TUI -> gateway/roteador OK`)
    } catch (e) {
      await page.screenshot({ path: join(destino, `falha-${cols}.png`), fullPage: true })
      writeFileSync(join(destino, `falha-${cols}.txt`), await page.evaluate(() => window.tela?.() || 'Terminal indisponivel'))
      throw e
    } finally {
      if (filho && !terminado) {
        writeFileSync(join(base, 'alvo', 'liberar-cota'), '')
        writeFileSync(join(base, 'alvo', 'liberar-fim'), '')
        filho.stdin.write('\x1b\x04')
        const limite = setTimeout(() => { try { process.kill(-filho.pid, 'SIGKILL') } catch {} }, 2000)
        await fim.finally(() => clearTimeout(limite))
      }
      await bomba
      writeFileSync(join(destino, `terminal-${cols}.ansi`), textoAnsi)
      await context.tracing.stop({ path: join(destino, `trace-${cols}.zip`) })
      await context.close()
      process.env = env
      rmSync(base, { recursive: true, force: true })
    }
  }
  const evidencia = { versao: 1, origem: 'Playwright + xterm.js + PTY Linux; IAs simuladas', capturas }
  writeFileSync(join(destino, 'capturas.json'), JSON.stringify(evidencia))
  const html = readFileSync('docs/processo-orquestracao.html', 'utf8')
    .replace('<meta charset="utf-8">', `<meta charset="utf-8"><base href="${pathToFileURL(resolve('docs/')).href}/">`)
    .replace('</html>', `<script type="application/json" id="tui-capturas-iniciais">${JSON.stringify(evidencia).replaceAll('<', '\\u003c')}</script></html>`)
  writeFileSync(join(destino, 'processo-orquestracao.html'), html)
  for (const width of [390, 1365]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const erros = []
    page.on('pageerror', e => erros.push(e.message))
    await page.goto(pathToFileURL(join(destino, 'processo-orquestracao.html')).href)
    await page.locator('#tui-stage:not([disabled])').waitFor()
    assert.ok(await page.locator('#tui-replay').isVisible())
    for (const [i, captura] of capturas.entries()) {
      await page.locator('#tui-stage').selectOption(String(i))
      await page.waitForFunction(() => {
        const img = document.getElementById('tui-image')
        return img.complete && img.naturalWidth > 300 && img.naturalHeight > 400
      })
      assert.equal(await page.locator('#tui-text').textContent(), captura.texto)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow no replay/${width}`)
      const pixels = await page.locator('#tui-image').evaluate(img => {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0)
        const dados = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let claros = 0
        for (let n = 0; n < dados.length; n += 4) if (dados[n] > 80 || dados[n + 1] > 80 || dados[n + 2] > 80) claros++
        return claros
      })
      assert.ok(pixels > 500, `captura vazia: ${captura.nome}`)
    }
    await page.locator('#tui-stage').selectOption('0')
    assert.ok(await page.locator('#tui-prev').isDisabled())
    await page.locator('#tui-next').click()
    assert.equal(await page.locator('#tui-stage').inputValue(), '1')
    await page.locator('#tui-prev').click()
    assert.equal(await page.locator('#tui-stage').inputValue(), '0')
    await page.locator('#tui-stage').selectOption(width === 390 ? '2' : '14')
    await page.screenshot({ path: join(destino, `replay-${width}.png`), fullPage: true })
    await page.locator('#tui-file').setInputFiles({ name: 'capturas.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(evidencia)) })
    await page.waitForFunction(() => document.getElementById('tui-stage').value === '0')
    const hostil = { ...evidencia, capturas: [{ ...capturas[0], nome: '<img src=x onerror=alert(1)>', texto: '<script>alert(1)</script>' }] }
    await page.locator('#tui-file').setInputFiles({ name: 'texto.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostil)) })
    await page.waitForFunction(() => document.getElementById('tui-stage').options.length === 1)
    assert.equal(await page.locator('#tui-text').textContent(), hostil.capturas[0].texto)
    assert.equal(await page.locator('#tui-text script, #tui-stage img').count(), 0)
    hostil.capturas[0].imagem = 'https://example.invalid/rastrear.png'
    await page.locator('#tui-file').setInputFiles({ name: 'invalido.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(hostil)) })
    await page.waitForFunction(() => document.getElementById('tui-error').textContent.length > 0)
    assert.deepEqual(erros, [])
    console.log(`Replay ${width}px: ${capturas.length} imagens, pixels, navegacao, importacao e XSS OK`)
    await page.close()
  }
  console.log(`Evidencias: ${destino}`)
} finally { await browser.close() }

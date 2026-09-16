import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { ambienteTui } from './ambiente-tui.ts'
import { allCards, patchCard, readCard } from '../../../motor/cordel/store.ts'
import { lerSessaoHii, fecharSessaoHii } from '../../../motor/euclides/sessoes.ts'
import { writeClarify, readClarify } from '../../../motor/agentes/clarice/clarificar.ts'
import { modoFor } from '../../../motor/tomada/registro.ts'
import { revelarIndicadores } from './navegacao.ts'
import { gravarRelatorio } from './relatorio.ts'
import { conferirVisual } from './visual.mjs'
import { semearUsoCodex } from './uso-fixture.ts'

const destino = resolve(process.argv[2] || '/tmp/hii-tui-visual')
mkdirSync(destino, { recursive: true })
assert.equal(readdirSync(destino).length, 0, 'Use um destino vazio para nao misturar evidencias de rodadas diferentes')
const manifesto = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtime: `Node ${process.version}; ${process.platform}; Chromium`, etapa: 'inicio', resultado: 'executando', colunas: 0, linhas: 36 }
const capturas = []
const relatar = () => gravarRelatorio(destino, capturas, manifesto)
relatar()
let browser
const quote = s => `'${s.replaceAll("'", "'\\''")}'`
try {
  // Antialiasing RGB do host muda pixels mesmo com a mesma fonte e geometria.
  browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text'] })
  for (const [cols, width] of [[48, 390], [100, 1365]]) {
    Object.assign(manifesto, { colunas: cols, linhas: 36, etapa: 'inicio' })
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
    let dimensoes = { cols, rows: 36 }
    let fim = Promise.resolve()
    let bomba = Promise.resolve()
    try {
      await page.setContent('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>HII TUI E2E</title><style>html,body{margin:0;background:#101716}#terminal{padding:12px;display:inline-block}</style><main id="terminal" aria-label="Terminal HII"></main></html>')
      await page.addStyleTag({ path: resolve('node_modules/@xterm/xterm/css/xterm.css') })
      const fonte = readFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf').toString('base64')
      await page.addStyleTag({ content: `@font-face{font-family:HiiMono;src:url(data:font/ttf;base64,${fonte})}` })
      await page.evaluate(() => document.fonts.load('12px HiiMono'))
      await page.addScriptTag({ path: resolve('node_modules/@xterm/xterm/lib/xterm.js') })
      await page.exposeFunction('entradaPty', texto => { if (!terminado) filho?.stdin.write(texto) })
      await page.evaluate(cols => {
        const term = new window.Terminal({ cols, rows: 36, fontSize: 12, fontFamily: 'HiiMono', cursorBlink: false,
          theme: { background: '#101716', foreground: '#e0e8e4' }, allowProposedApi: true })
        term.open(document.getElementById('terminal'))
        term.onData(data => window.entradaPty(data))
        term.focus()
        window.term = term
        window.tela = () => Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(term.buffer.active.viewportY + i)?.translateToString(true, 0, term.cols) || '').join('\n')
      }, cols)
      filho = spawn('script', ['-qefc', `stty cols ${cols} rows 36; tty > ${quote(join(base, 'pty'))}; exec ${quote(process.execPath)} ${quote(resolve('test/mirante/e2e/tui-filho.ts'))} ${quote(base)}`, '/dev/null'], {
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
      const redimensionar = async (cols, rows) => {
        await page.setViewportSize({ width: Math.max(390, cols * 8 + 24), height: 900 })
        await page.evaluate(({ cols, rows }) => window.term.resize(cols, rows), { cols, rows })
        execFileSync('stty', ['-F', readFileSync(join(base, 'pty'), 'utf8').trim(), 'cols', String(cols), 'rows', String(rows)])
        dimensoes = { cols, rows }
        Object.assign(manifesto, { colunas: cols, linhas: rows })
        await page.waitForFunction(cols => window.tela().split('\n')[1]?.includes('─'.repeat(cols)), cols)
      }
      const comando = async texto => {
        manifesto.etapa = texto.startsWith('/') ? texto.split(' ')[0] : 'enviar-pedido'
        relatar()
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
        capturas.push({ nome, colunas: dimensoes.cols, linhas: dimensoes.rows, texto, imagem: `data:image/png;base64,${png.toString('base64')}` })
        manifesto.etapa = nome
        relatar()
        if (process.env.HII_E2E_FALHAR_EM === nome) throw new Error(`Falha induzida na etapa ${nome}`)
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
      await page.keyboard.insertText('rascunho com acentos ação')
      await redimensionar(80, 24)
      await ver('rascunho com acentos ação')
      await capturar('streaming-resize')
      await redimensionar(cols, 36)
      await ver('rascunho com acentos ação')
      await page.keyboard.press('Control+u')
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
      await redimensionar(48, 24)
      await ver('Qual cor aplicar?')
      await capturar('pergunta-resize')
      await redimensionar(cols, 36)
      await page.keyboard.press('2')
      await ver('retomad')
      assert.equal(readClarify(pendente)[0].answer, 'verde')
      await page.keyboard.press('Control+c')
      await ver('enter retoma de onde parou')
      assert.equal(readCard(pendente).fm.status, 'HALTED')
      await capturar('interrompido')
      await page.keyboard.press('Enter')
      // "retomad" ja existe na resposta a pergunta anterior. Espere a dica de
      // HALTED desaparecer para nao aceitar aquele quadro antes do Enter.
      await page.waitForFunction(() => !window.tela().includes('enter retoma de onde parou'))
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
      await revelarIndicadores({
        texto: () => page.evaluate(() => window.tela()),
        tecla: tecla => page.keyboard.press(tecla),
        esperarTexto: ver,
        esperarMudanca: anterior => page.waitForFunction(anterior => window.tela() !== anterior, anterior),
      })
      await page.waitForFunction(() => /\[(ok|cota|sem-cli)\]/.test(window.tela()))
      await capturar('ias')
      await page.keyboard.press('Shift+Tab')
      await ver('codex: modo on-request')
      assert.equal(modoFor('implement'), 'on-request')
      await comando('/config')
      await ver('IAS')
      await page.keyboard.press('ArrowDown')
      await ver('selecionada: codex')
      await capturar('config')
      await page.keyboard.press('Escape')
      if (cols === 48) for (const [c, r] of [[48, 24], [80, 24], [120, 40]]) {
        await redimensionar(c, r)
        await comando('/config')
        await ver('selecionada: codex')
        await conferirVisual(page, `config-${c}x${r}`, destino)
        if (c === 48 && process.env.HII_ATUALIZAR_BASELINES !== '1') {
          await page.evaluate(() => {
            const corte = document.createElement('div')
            corte.id = 'corte-induzido'
            Object.assign(corte.style, { position: 'absolute', left: '24px', top: '80px', width: '160px', height: '32px', background: '#101716', zIndex: '50' })
            document.querySelector('#terminal').append(corte)
          })
          try {
            await assert.rejects(() => conferirVisual(page, `config-${c}x${r}`, destino, 'corte-induzido'), /Regressao visual/)
          } finally { await page.locator('#corte-induzido').evaluate(e => e.remove()) }
        }
        const paginas = []
        for (let n = 0; n < 40; n++) {
          const antes = await page.evaluate(() => window.tela())
          paginas.push(antes)
          assert.ok(antes.includes('❯'), 'Prompt desapareceu durante rolagem do /config')
          if (antes.includes('CUSTO NA JANELA DE 5H')) break
          await page.keyboard.press('PageDown')
          await page.waitForFunction(antes => window.tela() !== antes, antes)
        }
        const conteudo = paginas.join('\n')
        writeFileSync(join(destino, `config-${c}x${r}-paginas.txt`), conteudo)
        for (const texto of ['contexto', 'janela', 'modelo-teste', 'on-request', 'GASTO DO MOTOR · 5H', 'GASTO DO MOTOR · 7D', 'TOKENS 5H', 'LOOP EM EXECUCAO', 'CUSTO NA JANELA DE 5H']) assert.ok(conteudo.toLowerCase().includes(texto.toLowerCase()), `${texto} inacessivel em ${c}x${r}`)
        await capturar(`config-${c}x${r}-fim`)
        await page.keyboard.press('Escape')
      }
      await redimensionar(cols, 36)
      await comando('/config')
      await ver('selecionada: codex')
      await page.keyboard.press('Enter')
      await ver('codex')
      await page.keyboard.press('Escape')
      await comando('/model modelo-teste')
      await ver('modelo-teste')
      const antesDaColagem = allCards().length
      const execucoesAntesDaColagem = allCards().filter(c => c.tipo !== 'session').length
      const colagem = 'Conferir argv ação 界\nPreserve decisões e artefatos'
      await page.evaluate(texto => window.term.paste(texto), colagem)
      await ver('[colado #1 · 2 linhas]')
      assert.equal(allCards().length, antesDaColagem, 'Colagem multiline submeteu antes de Enter')
      await capturar('colagem-multilinha')
      await page.keyboard.press('Enter')
      await ver('ARGV_E_COLAGEM_CONFIRMADOS')
      await ver('nada em execucao')
      const argv = readFileSync(join(base, 'alvo', 'argv-ultima.txt'), 'utf8')
      assert.ok(argv.includes('approval_policy="on-request"'), 'Shift+Tab nao chegou ao CLI falso')
      assert.ok(argv.includes('-m\nmodelo-teste'), '/config e /model nao chegaram ao CLI falso')
      assert.ok(argv.includes(colagem), 'Colagem perdeu acentos, caractere largo ou quebra de linha')
      assert.equal(allCards().filter(c => c.tipo !== 'session').length, execucoesAntesDaColagem + 1)
      await capturar('argv-e-colagem')
      if (cols === 100) for (const estado of ['conhecido', 'esgotado', 'expirado', 'desconhecido']) {
        semearUsoCodex(base, estado)
        await comando('/config')
        await ver('selecionada: codex')
        // O painel repinta e consulta o leitor real, inclusive seu TTL de cache.
        await ver(estado === 'conhecido' ? '42%' : estado === 'esgotado' ? '100%' : estado === 'expirado' ? 'VELHO' : 'contexto nao reportado')
        await capturar(`uso-${estado}-config`)
        await page.keyboard.press('Escape')
        await comando('/ia')
        await revelarIndicadores({
          texto: () => page.evaluate(() => window.tela()), tecla: tecla => page.keyboard.press(tecla),
          esperarTexto: ver, esperarMudanca: anterior => page.waitForFunction(anterior => window.tela() !== anterior, anterior),
        })
        const indicador = estado === 'esgotado' ? '[cota]' : '[ok]'
        await page.waitForFunction(indicador => window.tela().split('\n').some(l => l.includes('codex') && l.includes(indicador)), indicador)
        await capturar(`uso-${estado}-ia`)
        await comando('/model')
        await ver('modelo-teste')
        await page.waitForFunction(indicador => window.tela().split('\n').some(l => l.includes('codex') && l.includes(indicador)), indicador)
        await capturar(`uso-${estado}-model`)
      }
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
      manifesto.resultado = 'falha'
      manifesto.erro = e.message
      relatar()
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
  manifesto.etapa = 'replay-portavel'
  relatar()
  for (const width of [390, 1365]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const erros = []
    page.on('pageerror', e => erros.push(e.message))
    await page.goto(pathToFileURL(join(destino, 'processo-orquestracao.html')).href)
    await page.locator('#tui-stage:not([disabled])').waitFor()
    assert.ok(await page.locator('#tui-replay').isVisible())
    for (const [i, captura] of capturas.entries()) {
      await page.locator('#tui-stage').selectOption(String(i))
      await page.waitForFunction(({ colunas, linhas }) => {
        const img = document.getElementById('tui-image')
        return img.complete && img.naturalWidth > colunas * 5 && img.naturalHeight > linhas * 10
      }, captura)
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
  const pacoteMovido = mkdtempSync(join(tmpdir(), 'hii-replay-movido-'))
  cpSync(destino, pacoteMovido, { recursive: true })
  const servidor = createServer((req, res) => {
    const caminho = resolve(pacoteMovido, '.' + (req.url || '/'))
    if (!caminho.startsWith(pacoteMovido + '/')) { res.writeHead(403).end(); return }
    try {
      res.setHeader('content-type', caminho.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8')
      res.end(readFileSync(caminho))
    } catch { res.writeHead(404).end() }
  })
  await new Promise(res => servidor.listen(0, '127.0.0.1', res))
  try {
    const url = `http://127.0.0.1:${servidor.address().port}`
    const page = await browser.newPage()
    await page.goto(`${url}/processo-orquestracao.html`)
    await page.locator('#tui-stage:not([disabled])').waitFor()
    for (const href of await page.locator('a[href^="docs/"]').evaluateAll(links => links.map(a => a.getAttribute('href')))) {
      assert.ok((await page.request.get(`${url}/${href}`)).ok(), `Link portavel quebrado: ${href}`)
    }
    await page.close()
  } finally {
    await new Promise(res => servidor.close(res))
    rmSync(pacoteMovido, { recursive: true, force: true })
  }
  manifesto.resultado = 'aprovado'
  manifesto.etapa = 'concluido'
  relatar()
  console.log(`Evidencias: ${destino}`)
} catch (e) {
  manifesto.resultado = 'falha'
  manifesto.erro = e.message
  relatar()
  throw e
} finally { await browser?.close() }

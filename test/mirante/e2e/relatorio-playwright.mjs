import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const destino = resolve(process.argv[2])
mkdirSync(destino, { recursive: true })
for (const [nome, env] of [
  ['etapa', { HII_E2E_FALHAR_EM: 'inicio' }],
  ['browser', { PLAYWRIGHT_BROWSERS_PATH: join(destino, 'browser-ausente') }],
]) {
  const pasta = join(destino, nome)
  const r = spawnSync(process.execPath, ['test/mirante/e2e/tui-playwright.mjs', pasta], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000,
  })
  assert.equal(r.status, 1, `Falha induzida ${nome} nao ocorreu: ${r.stderr}`)
  const manifesto = JSON.parse(readFileSync(join(pasta, 'manifesto.json'), 'utf8'))
  assert.equal(manifesto.resultado, 'falha')
  assert.ok(manifesto.erro)
  assert.ok(manifesto.commit && manifesto.runtime)
}
const movido = join(destino, 'pacote-movido')
renameSync(join(destino, 'etapa'), movido)
const servidor = createServer((req, res) => {
  const path = resolve(movido, '.' + req.url)
  if (!path.startsWith(movido + '/')) { res.writeHead(403).end(); return }
  try {
    res.setHeader('content-type', path.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain')
    res.end(readFileSync(path))
  } catch { res.writeHead(404).end() }
})
await new Promise(res => servidor.listen(0, '127.0.0.1', res))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const url = `http://127.0.0.1:${servidor.address().port}`
  await page.goto(`${url}/processo-orquestracao.html`)
  await page.locator('#tui-stage:not([disabled])').waitFor()
  assert.equal(await page.locator('#tui-stage option').count(), 1)
  assert.ok((await page.locator('[role=status]').textContent()).includes('Falha induzida'))
  await page.waitForFunction(() => document.getElementById('tui-image').naturalWidth > 300)
  for (const href of await page.locator('a[href]').evaluateAll(as => as.map(a => a.getAttribute('href')).filter(h => !h.startsWith('#')))) {
    assert.ok(!href.includes('file:'))
    assert.ok((await page.request.get(`${url}/${href}`)).ok(), `link ausente: ${href}`)
  }
  await page.screenshot({ path: join(destino, 'replay-parcial-http.png'), fullPage: true })
  console.log('Relatorio: falha de etapa e browser, replay parcial movido servido por HTTP e documentacao OK')
} finally {
  await browser?.close()
  await new Promise(res => servidor.close(res))
}

import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const destino = process.argv[2] || '/tmp/hii-visualizador'
mkdirSync(destino, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
    const erros = []
    page.on('pageerror', e => erros.push(e.message))
    await page.goto(pathToFileURL(resolve('docs/processo-orquestracao.html')).href)
    await page.locator('#steps button').first().waitFor()
    assert.equal(await page.locator('#stat-mode').textContent(), 'Gateway')
    await page.locator('#passivo').click()
    assert.equal(await page.locator('#steps button').count(), 8)
    await page.locator('#steps button').last().click()
    assert.equal(await page.locator('#step-title').textContent(), 'PR remoto')
    const pixel = await page.locator('#flow').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let preenchidos = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 220 && pixels[i + 1] < 240) preenchidos++
      return preenchidos
    })
    assert.ok(pixel > 1000, `canvas vazio: ${pixel}`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow horizontal')
    await page.screenshot({ path: `${destino}/processo-${viewport.width}.png`, fullPage: true })
    for (const tab of ['contratos', 'evidencias', 'escopo']) {
      await page.locator(`#tab-${tab}`).click()
      assert.ok(await page.locator(`#${tab}`).isVisible())
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow em ${tab}`)
    }
    await page.locator('#search').fill('#49')
    assert.equal(await page.locator('#issue-table tbody tr:visible').count(), 1)
    await page.locator('#tab-fluxo').click()
    const snapshot = { versao: 1, conversas: [{ id: '900', repo: 'org/app', titulo: '<img src=x onerror=alert(1)>', estado: 'aberta', execucoes: [], subsessoes: [] }], orquestrador: { modo: 'gateway' } }
    await page.locator('#snapshot').setInputFiles({ name: 'snapshot.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(snapshot)) })
    await page.waitForFunction(() => document.getElementById('source-note').textContent.includes('snapshot.json'))
    assert.equal(await page.locator('#sessions img').count(), 0)
    assert.equal(await page.locator('#stat-runs').textContent(), '0')
    await page.locator('#snapshot').setInputFiles({ name: 'invalido.json', mimeType: 'application/json', buffer: Buffer.from('{') })
    await page.waitForFunction(() => document.getElementById('load-error').textContent.length > 0)
    await page.locator('#reset').click()
    assert.equal(await page.locator('#stat-runs').textContent(), '2')
    assert.deepEqual(erros, [])
    console.log(`${viewport.width}x${viewport.height}: fluxo, canvas (${pixel} pixels), abas, filtro, snapshot e XSS OK`)
    await page.close()
  }
} finally { await browser.close() }

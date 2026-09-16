import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

export async function conferirVisual(page, nome, destino, sufixo = 'atual') {
  const arquivo = resolve('test/mirante/e2e/baselines', `${nome}.png`)
  // So valores volateis: bytes de disco e idade de atividade; nunca paineis inteiros.
  await page.evaluate(() => {
    const term = window.term
    const rect = document.querySelector('.xterm-screen').getBoundingClientRect()
    const cw = rect.width / term.cols, ch = rect.height / term.rows
    for (let y = 0; y < term.rows; y++) {
      const linha = term.buffer.active.getLine(term.buffer.active.viewportY + y)?.translateToString(true, 0, term.cols) || ''
      for (const m of linha.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|ms)\b|\b\d{2}:\d{2}(?::\d{2})?\b|\bpid \d+\b/g)) {
        const mask = document.createElement('div')
        mask.dataset.visualMask = 'true'
        Object.assign(mask.style, { position: 'fixed', left: `${rect.left + m.index * cw}px`, top: `${rect.top + y * ch}px`, width: `${m[0].length * cw}px`, height: `${ch}px`, background: '#101716', zIndex: '100' })
        document.body.append(mask)
      }
    }
  })
  let atual
  try { atual = await page.locator('#terminal').screenshot({ path: resolve(destino, `${nome}-${sufixo}.png`) }) }
  finally { await page.locator('[data-visual-mask]').evaluateAll(ms => ms.forEach(m => m.remove())) }
  if (process.env.HII_ATUALIZAR_BASELINES === '1' && !process.env.CI) {
    mkdirSync(dirname(arquivo), { recursive: true })
    writeFileSync(arquivo, atual)
    return
  }
  assert.ok(existsSync(arquivo), `Baseline ausente: ${nome}; gere e revise explicitamente com HII_ATUALIZAR_BASELINES=1`)
  const diferenca = await page.evaluate(async ([antes, depois]) => {
    const pixels = async src => {
      const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0)
      return { w: c.width, h: c.height, data: ctx.getImageData(0, 0, c.width, c.height).data }
    }
    const a = await pixels(antes), b = await pixels(depois)
    if (a.w !== b.w || a.h !== b.h) return 1
    let diferentes = 0
    for (let i = 0; i < a.data.length; i += 4) {
      if (Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c]))) > 35) diferentes++
    }
    return diferentes / (a.w * a.h)
  }, [readFileSync(arquivo).toString('base64'), atual.toString('base64')])
  assert.ok(diferenca < 0.003, `Regressao visual ${nome}: ${(100 * diferenca).toFixed(3)}% dos pixels divergem`)
}

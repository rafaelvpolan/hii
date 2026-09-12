import { test, expect, afterAll } from '../apoio/runner.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runtimeDeScript } from '../../motor/cordel/alicerce/runtime.ts'
import { ROOT } from '../../motor/cordel/alicerce/config.ts'
import { dormir } from '../apoio/runner.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-estatico-'))
const filhos: ChildProcess[] = []
afterAll(() => {
  for (const f of filhos) { try { f.kill('SIGKILL') } catch { void 0 } }
  rmSync(BASE, { recursive: true, force: true })
})

async function esperarHttp(url: string, tetoMs: number): Promise<Response | null> {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    try { return await fetch(url) } catch { await dormir(100) }
  }
  return null
}

test('PONTA A PONTA: o live server do motor serve a pasta, injeta o recarregamento no HTML, protege contra ../ e cai no index.html em rota de SPA', async () => {
  const site = join(BASE, 'public')
  mkdirSync(join(site, 'css'), { recursive: true })
  writeFileSync(join(site, 'index.html'), '<html><body><h1>oi</h1></body></html>')
  writeFileSync(join(site, 'css', 'a.css'), 'h1{color:red}')
  writeFileSync(join(BASE, 'segredo.txt'), 'nao servir')
  const porta = 5900 + Math.floor(Math.random() * 90)
  const filho = spawn(runtimeDeScript(), [join(ROOT, 'scripts', 'servidor-estatico.mjs'), '--dir', site, '--port', String(porta)], { stdio: 'ignore' })
  filhos.push(filho)
  const base = `http://127.0.0.1:${porta}`
  const r = await esperarHttp(`${base}/`, 8000)
  expect(r?.status).toBe(200)
  const html = await r!.text()
  expect(html).toContain('<h1>oi</h1>')
  expect(html, 'o script de recarregar entra antes de </body>').toContain('/__hii/recarregar')
  const css = await fetch(`${base}/css/a.css`)
  expect(css.status).toBe(200)
  expect(css.headers.get('content-type')).toContain('text/css')
  const fora = await fetch(`${base}/../segredo.txt`)
  expect([403, 404]).toContain(fora.status)
  const spa = await fetch(`${base}/rota/interna`)
  expect(spa.status, 'rota sem extensao cai no index.html').toBe(200)
  expect(await spa.text()).toContain('<h1>oi</h1>')
  const sumiu = await fetch(`${base}/nao-existe.png`)
  expect(sumiu.status).toBe(404)
}, 20000)

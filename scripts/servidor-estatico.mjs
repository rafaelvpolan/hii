// Live server do motor: serve uma pasta estatica e recarrega o navegador quando um
// arquivo muda. Existe para o projeto que nao tem `dev`/`start` nenhum — um site em
// HTML puro, uma pasta `public/` ou `dist/` — ainda ganhar preview no card, sem
// depender de `npx live-server` (rede na primeira vez) nem de python no host.
//
// uso: <runtime> scripts/servidor-estatico.mjs --dir <pasta> --port <n> [--host 127.0.0.1]
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json', '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
}

const RECARREGAR = '\n<script>(function(){try{new EventSource("/__hii/recarregar").onmessage=function(){location.reload()}}catch(e){}})()</script>\n'

function argumento(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao
}

const raiz = resolve(argumento('dir', '.'))
const porta = Number(argumento('port', '0'))
const host = argumento('host', '127.0.0.1')
if (!porta) { process.stderr.write('servidor-estatico: --port obrigatorio\n'); process.exit(2) }
if (!existsSync(raiz)) { process.stderr.write(`servidor-estatico: pasta nao existe: ${raiz}\n`); process.exit(2) }

const ouvintes = new Set()
function avisarRecarga() {
  for (const res of ouvintes) { try { res.write('data: recarregar\n\n') } catch { ouvintes.delete(res) } }
}
let agendado = null
try {
  watch(raiz, { recursive: true }, () => {
    clearTimeout(agendado)
    agendado = setTimeout(avisarRecarga, 120)
  })
} catch {
  process.stderr.write('servidor-estatico: watch recursivo indisponivel neste sistema — o recarregamento automatico fica desligado\n')
}

function caminhoSeguro(urlPath) {
  const limpo = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const alvo = resolve(join(raiz, limpo))
  return alvo === raiz || alvo.startsWith(raiz + sep) ? alvo : null
}

function responderArquivo(res, caminho) {
  const tipo = MIME[extname(caminho).toLowerCase()] ?? 'application/octet-stream'
  let corpo = readFileSync(caminho)
  if (tipo.startsWith('text/html')) {
    const html = corpo.toString('utf8')
    corpo = Buffer.from(html.includes('</body>') ? html.replace('</body>', `${RECARREGAR}</body>`) : html + RECARREGAR)
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'Content-Length': corpo.length })
  res.end(corpo)
}

const servidor = createServer((req, res) => {
  const url = req.url ?? '/'
  if (url.startsWith('/__hii/recarregar')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': ligado\n\n')
    ouvintes.add(res)
    req.on('close', () => ouvintes.delete(res))
    return
  }
  const alvo = caminhoSeguro(url)
  if (!alvo) { res.writeHead(403); res.end('fora da pasta servida'); return }
  let caminho = alvo
  try {
    if (statSync(caminho).isDirectory()) caminho = join(caminho, 'index.html')
  } catch { void 0 }
  if (!existsSync(caminho)) {
    // SPA: rota que nao e arquivo cai no index.html da raiz, se houver.
    const indice = join(raiz, 'index.html')
    if (!extname(alvo) && existsSync(indice)) { responderArquivo(res, indice); return }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`nao encontrado: ${url}`); return
  }
  responderArquivo(res, caminho)
})

servidor.listen(porta, host, () => {
  process.stdout.write(`servidor-estatico: ${raiz} em http://${host}:${porta} (recarrega ao salvar)\n`)
})
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => { servidor.close(); process.exit(0) })

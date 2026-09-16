import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface Captura {
  nome: string
  colunas: number
  linhas: number
  texto: string
  imagem: string
}

export interface Manifesto {
  commit: string
  runtime: string
  etapa: string
  resultado: 'executando' | 'falha' | 'aprovado'
  colunas: number
  linhas: number
  erro?: string
}

function gravar(destino: string, texto: string): void {
  writeFileSync(`${destino}.tmp`, texto)
  renameSync(`${destino}.tmp`, destino)
}

export function gravarRelatorio(destino: string, capturas: Captura[], manifesto: Manifesto): void {
  mkdirSync(destino, { recursive: true })
  if (!existsSync(join(destino, 'docs'))) cpSync(resolve('docs'), join(destino, 'docs'), { recursive: true })
  const evidencia = { versao: 1, origem: 'Playwright + xterm.js + PTY Linux; IAs simuladas', capturas }
  gravar(join(destino, 'capturas.json'), JSON.stringify(evidencia))
  gravar(join(destino, 'manifesto.json'), JSON.stringify(manifesto, null, 2))
  const seguro = (texto: string): string => texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  const estado = `<aside role="status" class="wrap">Rodada: ${seguro(manifesto.resultado)} · etapa: ${seguro(manifesto.etapa)} · ${manifesto.colunas}×${manifesto.linhas} · commit ${seguro(manifesto.commit)} · ${seguro(manifesto.runtime)}${manifesto.erro ? `<p>${seguro(manifesto.erro)}</p>` : ''} · <a href="manifesto.json">Manifesto</a></aside>`
  const html = readFileSync(resolve('docs/processo-orquestracao.html'), 'utf8')
    .replace(/href="(?!#|https?:|mailto:)([^"]+)"/g, 'href="docs/$1"')
    .replace('<header>', `${estado}<header>`)
    .replace('</html>', capturas.length ? `<script type="application/json" id="tui-capturas-iniciais">${JSON.stringify(evidencia).replaceAll('<', '\\u003c')}</script></html>` : '</html>')
  gravar(join(destino, 'processo-orquestracao.html'), html)
}

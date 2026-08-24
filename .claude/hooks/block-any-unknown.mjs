#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { temDiretivaAny, TS_EXT, findViolations } from '../../scripts/no-any-detect.mjs'

function newTexts(tool, input) {
  if (tool === 'Write') return [input.content || '']
  if (tool === 'Edit') return [input.new_string || '']
  if (tool === 'MultiEdit') return (input.edits || []).map(e => e.new_string || '')
  return []
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => raw += d)
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw)
    const tool = ev.tool_name
    const input = ev.tool_input || {}
    const path = input.file_path || ''
    const ext = (path.split('.').pop() || '').toLowerCase()
    if (!TS_EXT.has(ext)) process.exit(0)

    // A diretiva vale no TOPO do arquivo, e o que conta e o topo do arquivo
    // RESULTANTE — nao o do arquivo em disco. Ler so o disco criava dois furos
    // opostos, os dois reais:
    //
    //  - Write de arquivo NOVO: o arquivo ainda nao existe, whole='' (ENOENT), e o
    //    escape que a mensagem la embaixo promete ("no topo do arquivo") era
    //    inalcancavel na criacao — nao havia como criar um arquivo com divida
    //    assumida.
    //  - Write de arquivo EXISTENTE: a diretiva era lida do conteudo ANTIGO, entao
    //    um Write que REMOVE a diretiva e introduz `any` no mesmo movimento passava
    //    isento.
    //
    // Testar contra o new_string de um Edit continua fora de questao: qualquer
    // trecho editado desligaria o portao so por conter o token.
    let doDisco = ''
    try { doDisco = readFileSync(path, 'utf8') } catch (e) {
      if (e?.code !== 'ENOENT') {
        process.stderr.write(`[hicode] block-any-unknown: nao consegui ler ${path} (${e?.code || e?.message}) — seguindo pela verificacao do trecho novo\n`)
      }
      doDisco = ''
    }
    // Num Write, o conteudo entregue E o arquivo resultante inteiro: e nele que a
    // diretiva tem de estar. Nos demais casos vale o topo do arquivo em disco.
    const paraDiretiva = tool === 'Write' ? (input.content || '') : doDisco
    if (temDiretivaAny(paraDiretiva)) process.exit(0)

    const hits = newTexts(tool, input).flatMap(t => findViolations(t, ext))
    if (!hits.length) process.exit(0)

    const list = hits.slice(0, 8).map(h => `  ${h.kind}`).join('\n')
    process.stderr.write(
`BLOQUEADO: uso de "any"/"unknown" na tipagem (regra de tipagem do hicode — CLAUDE.md).

Arquivo: ${path}
${list}

Tipe de verdade: defina uma interface/tipo, um union concreto, generics (<T>), ou
tipos utilitarios. Para JSON externo, valide/parseie para um tipo conhecido.

Escape (ultimo caso, divida tecnica assumida): diretiva "hicode:allow-any" no topo do arquivo.
`)
    process.exit(2)
  } catch (e) {
    // Sair 0 aqui e escolha: um bug neste hook nao pode travar toda escrita. Mas
    // sair 0 CALADO transforma o portao em decoracao sem ninguem perceber.
    process.stderr.write(`[hicode] block-any-unknown: falhou ao avaliar (${e?.message || e}) — a escrita seguiu SEM verificacao de tipagem\n`)
    process.exit(0)
  }
})

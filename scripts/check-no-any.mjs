#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { temDiretivaAny, TS_EXT, findViolations } from './no-any-detect.mjs'

const ROOTS = ['runner.ts', 'bin', 'motor']
const SKIP_DIR = new Set(['node_modules', '.nuxt', '.output', 'dist', '.git'])

function walk(entry, acc) {
  let st
  // Raiz ilegivel nao pode virar "nada a varrer": era assim que este lint
  // imprimia "ok" tendo inspecionado zero arquivo.
  try { st = statSync(entry) } catch (e) {
    process.stderr.write(`lint no-any: nao consegui ler "${entry}" (${e?.code || e?.message}) — a varredura esta incompleta\n`)
    process.exitCode = 1
    return
  }
  if (st.isDirectory()) {
    if (SKIP_DIR.has(entry.split('/').pop() || '')) return
    for (const name of readdirSync(entry)) walk(join(entry, name), acc)
    return
  }
  const ext = extname(entry).slice(1).toLowerCase()
  if (TS_EXT.has(ext)) acc.push(entry)
}

const files = []
for (const r of ROOTS) walk(r, files)

// Um lint que varreu zero arquivo e um lint que nao rodou. Afirmar "ok" nesse
// estado e a falha silenciosa que este gate existe para impedir nos outros.
if (!files.length) {
  process.stderr.write(`lint no-any: nenhum arquivo varrido em ${ROOTS.join(', ')} (cwd: ${process.cwd()}) — o gate nao inspecionou nada\n`)
  process.exit(1)
}

let total = 0
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  if (temDiretivaAny(text)) continue
  const ext = extname(f).slice(1).toLowerCase()
  const hits = findViolations(text, ext)
  for (const h of hits) {
    process.stdout.write(`${f}:${h.line}  ${h.kind}\n`)
    total++
  }
}

if (total) {
  process.stderr.write(`\nlint no-any: ${total} uso(s) de any/unknown proibido(s). Tipe de verdade ou use hicode:allow-any.\n`)
  process.exit(1)
}
process.stdout.write(`lint no-any: ok (nenhum any/unknown em ${files.length} arquivo(s))\n`)
process.exit(process.exitCode || 0)

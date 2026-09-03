#!/usr/bin/env node
// Estatisticas deterministicas de receipts/receipts.jsonl — zero IA.
// Uso: node scripts/generativo/receitas-stats.mjs [--json out.json]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const linhas = readFileSync('receipts/receipts.jsonl', 'utf8').split('\n').filter(Boolean)
const porTool = {}
const porDia = {}
let assinados = 0
let invalidos = 0

for (const l of linhas) {
  let r
  try { r = JSON.parse(l) } catch { invalidos++; continue }
  const tool = r.tool || '(vazio)'
  porTool[tool] = (porTool[tool] || 0) + 1
  if (r.signed) assinados++
  const m = /^tu-(\d+)-/.exec(r.request_id || '')
  if (m) {
    const dia = new Date(Number(m[1])).toISOString().slice(0, 10)
    porDia[dia] = (porDia[dia] || 0) + 1
  }
}

const rel = {
  gerado_em: new Date().toISOString(),
  total: linhas.length, invalidos, assinados,
  pct_assinados: linhas.length ? +(100 * assinados / linhas.length).toFixed(1) : 0,
  por_tool: Object.fromEntries(Object.entries(porTool).sort((a, b) => b[1] - a[1])),
  por_dia: Object.fromEntries(Object.entries(porDia).sort()),
}

const i = process.argv.indexOf('--json')
if (i >= 0) {
  mkdirSync(dirname(process.argv[i + 1]), { recursive: true })
  writeFileSync(process.argv[i + 1], JSON.stringify(rel, null, 2))
}
console.log(JSON.stringify(rel, null, 2))

#!/usr/bin/env node
// Wrapper zero-dependencia para o Ollama local (/api/generate).
// Uso:
//   node scripts/generativo/ollama.mjs --model qwen3-coder:30b --prompt-file p.txt --resposta out.md
//   cat p.txt | node scripts/generativo/ollama.mjs --model qwen3-coder:30b
// Toda chamada e logada em JSONL (default generativo/runs/chamadas.jsonl) com
// tokens medidos — custo local e zero, mas o log permite comparar modelos.
// HTTP via curl (mesmo padrao de motor/tomada/.../ollama.ts): o fetch do Node
// mata respostas lentas no headersTimeout de 300s, e modelo 30B passa disso.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

function arg(nome, dflt) {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : dflt
}

const model = arg('model', process.env.HICODE_OLLAMA_MODEL || 'qwen3-coder:30b')
const base = (arg('url', process.env.HICODE_OLLAMA_URL || 'http://localhost:11434')).replace(/\/$/, '')
const promptFile = arg('prompt-file', null)
const respostaPath = arg('resposta', null)
const logPath = arg('log', 'generativo/runs/chamadas.jsonl')

const prompt = promptFile ? readFileSync(promptFile, 'utf8') : readFileSync(0, 'utf8')
if (!prompt.trim()) { console.error('prompt vazio'); process.exit(2) }

const bodyPath = join(tmpdir(), `ollama-gen-${process.pid}.json`)
writeFileSync(bodyPath, JSON.stringify({ model, prompt, stream: false }))

const t0 = Date.now()
let stdout
try {
  stdout = execFileSync('curl', [
    '-sS', '--noproxy', '*', '-H', 'Content-Type: application/json',
    `${base}/api/generate`, '-d', `@${bodyPath}`,
  ], { maxBuffer: 64 * 1024 * 1024 }).toString()
} catch (e) {
  console.error(`ollama: curl falhou — ${e.message}`)
  process.exit(1)
} finally {
  unlinkSync(bodyPath)
}
const durMs = Date.now() - t0

let j
try { j = JSON.parse(stdout) } catch { console.error('ollama: resposta nao-JSON'); process.exit(1) }
if (j.error) { console.error(`ollama: ${j.error}`); process.exit(1) }

mkdirSync(dirname(logPath), { recursive: true })
appendFileSync(logPath, JSON.stringify({
  ts: new Date().toISOString(), model,
  prompt_file: promptFile, tokens_in: j.prompt_eval_count || 0,
  tokens_out: j.eval_count || 0, dur_ms: durMs, ok: true,
}) + '\n')

if (respostaPath) { mkdirSync(dirname(respostaPath), { recursive: true }); writeFileSync(respostaPath, j.response || '') }
else process.stdout.write(j.response || '')
console.error(`[ollama] ${model} — ${j.prompt_eval_count || 0}in/${j.eval_count || 0}out tok, ${(durMs / 1000).toFixed(1)}s`)

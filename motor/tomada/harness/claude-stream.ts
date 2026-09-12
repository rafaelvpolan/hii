import { FORMATO_STREAM, claudeArgv } from './claude-argv.ts'
import { spawn } from 'node:child_process'
import { appendFileSync, writeFileSync, readFileSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyUsage } from '../uso.ts'
import { semControle } from '../../cordel/util.ts'
import { AcumuladorDeLinhas, cabecalhoDaChamada, carimboAgora, comRaia } from './live-log.ts'
import { COST_UNKNOWN, readReportedCost } from '../../euclides/tesouro/custo.ts'
import type { CostReading } from '../../euclides/tesouro/custo.ts'
import type { AgentRequest, AgentResult } from '../tipos.ts'
import type { Usage } from '../../cordel/index.ts'

const NONINTERACTIVE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_EDITOR: 'true',
  GIT_SEQUENCE_EDITOR: 'true',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
}

interface StreamPart {
  type: string
  text?: string
  name?: string
  id?: string
  tool_use_id?: string
  input?: object
  content?: string | object
}

const FERRAMENTAS_DE_IA = ['Task']
const LIMITE_DA_RESPOSTA_DE_IA = 4000
// O corte para caber na tela e do render, na largura do terminal; aqui so se
// impede que um resultado gigante vire uma linha de megabytes no log.
const LIMITE_DA_LINHA_DE_FERRAMENTA = 600

export { cabecalhoDaChamada }

function textoDoResultado(content: string | object | undefined): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(parte => (parte && typeof parte === 'object' && 'text' in parte && typeof (parte as { text?: string }).text === 'string' ? (parte as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  }
  try { return JSON.stringify(content ?? '') } catch { return '' }
}

export function respostaDeIa(content: string | object | undefined, ferramenta: string): string[] {
  const texto = semControle(textoDoResultado(content)).trim()
  const cortado = texto.length > LIMITE_DA_RESPOSTA_DE_IA ? texto.slice(0, LIMITE_DA_RESPOSTA_DE_IA) + '…' : texto
  return [`  ← ${ferramenta} respondeu:`, ...cortado.split('\n')]
}

interface StreamEvent {
  type?: string
  subtype?: string
  model?: string
  message?: { content?: StreamPart[] }
  total_cost_usd?: number
  result?: string
  is_error?: boolean
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
}

function usageFrom(u: StreamEvent['usage']): Usage {
  return {
    tokens_in: u?.input_tokens || 0,
    tokens_out: u?.output_tokens || 0,
    tokens_cache_create: u?.cache_creation_input_tokens || 0,
    tokens_cache_read: u?.cache_read_input_tokens || 0,
  }
}

function short(v: object | string | undefined): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return s.length > LIMITE_DA_LINHA_DE_FERRAMENTA ? s.slice(0, LIMITE_DA_LINHA_DE_FERRAMENTA) + '…' : s
  } catch {
    return ''
  }
}

export function renderEvent(ev: StreamEvent, ferramentasEmVoo: Map<string, string> = new Map()): string {
  if (ev.type === 'system' && ev.subtype === 'init') return `— sessao iniciada${ev.model ? ' (' + ev.model + ')' : ''} —`
  if (ev.type === 'assistant' && ev.message?.content) {
    const parts: string[] = []
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text) parts.push(semControle(c.text).trim())
      else if (c.type === 'tool_use') {
        if (c.id) ferramentasEmVoo.set(c.id, c.name || 'tool')
        parts.push(`  → ${c.name || 'tool'}(${short(c.input)})`)
      }
    }
    return parts.filter(Boolean).join('\n')
  }
  if (ev.type === 'user' && ev.message?.content) {
    for (const c of ev.message.content) {
      if (c.type !== 'tool_result') continue
      const ferramenta = c.tool_use_id ? ferramentasEmVoo.get(c.tool_use_id) ?? '' : ''
      if (c.tool_use_id) ferramentasEmVoo.delete(c.tool_use_id)
      if (FERRAMENTAS_DE_IA.includes(ferramenta)) return respostaDeIa(c.content, ferramenta).join('\n')
      return `  ← ${short(c.content).replace(/\s+/g, ' ')}`
    }
  }
  if (ev.type === 'result') return `— concluido (custo $${(Number(ev.total_cost_usd) || 0).toFixed(4)}) —`
  return ''
}

function argvStream(req: AgentRequest): string[] {
  return claudeArgv(req, FORMATO_STREAM)
}

const LOG_MAX = Number(process.env.HII_LIVELOG_MAX_BYTES || 1_000_000)
const LOG_KEEP = Number(process.env.HII_LIVELOG_KEEP_BYTES || 200_000)

function podarLog(caminho: string): void {
  try {
    if (!existsSync(caminho) || statSync(caminho).size <= LOG_MAX) return
    const conteudo = readFileSync(caminho, 'utf8')
    writeFileSync(caminho, `— log podado, mantidos os ultimos ${Math.round(LOG_KEEP / 1000)}KB —\n` + conteudo.slice(-LOG_KEEP))
  } catch {
    void 0
  }
}

export function runClaudeStream(req: AgentRequest, liveLog: string): Promise<AgentResult> {
  const dir = dirname(liveLog)
  if (!existsSync(dir)) { try { mkdirSync(dir, { recursive: true }) } catch { void 0 } }
  podarLog(liveLog)
  const write = (s: string): void => { try { appendFileSync(liveLog, comRaia(s, req.raia)) } catch { void 0 } }
  const stderrAcumulado = new AcumuladorDeLinhas()
  write(`\n${cabecalhoDaChamada(carimboAgora(), req.rotulo)}\n`)
  const ferramentasEmVoo = new Map<string, string>()

  return new Promise<AgentResult>((resolve) => {
    let text = ''
    let assistantText = ''
    let reading: CostReading = COST_UNKNOWN
    let isError = false
    let usage = emptyUsage()
    let gotResult = false
    let buf = ''
    let settled = false
    let timedOut = false
    let hard: ReturnType<typeof setTimeout> | null = null

    const child = spawn('claude', argvStream(req), { cwd: req.cwd, env: { ...process.env, ...NONINTERACTIVE_ENV }, stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.pid) req.aoIniciar?.(child.pid)

    const soft = setTimeout(() => {
      timedOut = true
      write('\n— TIMEOUT: encerrando a IA —\n')
      try { child.kill('SIGTERM') } catch { void 0 }
      hard = setTimeout(() => { try { child.kill('SIGKILL') } catch { void 0 } }, 5000)
    }, req.timeoutMs)

    const done = (failed: boolean, detail = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(soft)
      if (hard) clearTimeout(hard)
      resolve({ ok: !failed && !isError, failed, timedOut, isError, detail, text: text || assistantText, ...reading, usage })
    }

    const handleLine = (line: string): void => {
      if (!line.trim()) return
      try {
        const ev = JSON.parse(line) as StreamEvent
        // O CLI pode emitir `result` mais de uma vez na mesma chamada (visto no card
        // 007: duas linhas de conclusao identicas). So a primeira fecha o bloco.
        if (ev.type === 'result' && gotResult) return
        const human = renderEvent(ev, ferramentasEmVoo)
        if (human) write(semControle(human) + '\n')
        if (ev.type === 'assistant' && ev.message?.content) {
          for (const c of ev.message.content) if (c.type === 'text' && c.text) assistantText = c.text
        }
        if (ev.type === 'result') {
          gotResult = true
          reading = readReportedCost(ev.total_cost_usd)
          text = String(ev.result ?? '')
          isError = !!ev.is_error
          usage = usageFrom(ev.usage)
        }
      } catch {
        write(line + '\n')
      }
    }

    child.stdout.on('data', (d: Buffer) => {
      buf += String(d)
      let i = buf.indexOf('\n')
      while (i >= 0) {
        handleLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
        i = buf.indexOf('\n')
      }
    })

    child.stderr.on('data', (d: Buffer) => { for (const l of stderrAcumulado.empurrar(String(d))) write(l + '\n') })
    child.on('error', (e: Error) => done(true, String(e?.message || e)))
    child.on('close', (code: number | null) => {
      if (buf.trim()) handleLine(buf)
      for (const l of stderrAcumulado.esvaziar()) write(l + '\n')
      if (!gotResult && code) isError = true
      done(timedOut || !gotResult, timedOut ? 'timeout' : code ? `exit ${code}` : '')
    })
  })
}

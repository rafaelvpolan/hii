import { extractObjetivo } from '../../cordel/index.ts'
import type { Card, Fields } from '../../cordel/index.ts'
import { ROOT, GATE_DIFF_LIMIT } from '../../cordel/alicerce/config.ts'
import { runGit } from '../../quilombo/git.ts'
import { modelFor, providerFor } from '../../tomada/registro.ts'
import { campoDeOverrideDoPapel } from '../../tomada/rota.ts'
import { esforcoGovernado, modeloGovernado, registrarTier, tierDaAcaoDoCard } from '../../oswaldo/rui.ts'
import { runProvider } from '../../euclides/tesouro/confianca.ts'
import { sumTokens } from '../../tomada/uso.ts'

export interface EvalResult {
  score: number
  meets: boolean
  notes: string
  cost: number
  tokens: number
}

export async function evaluate(card: Card, wt: string, base: string): Promise<EvalResult> {
  const desc = extractObjetivo(card.body) || card.fm.title || ''
  const diff = (await runGit(wt, ['diff', `origin/${base}`, '--', '.', ':!node_modules'])).stdout.slice(0, GATE_DIFF_LIMIT)
  const overrideDoVerify = card.fm[campoDeOverrideDoPapel('verify')] || undefined
  const provider = providerFor('verify', overrideDoVerify)
  const prompt = [
    'Voce e um avaliador de qualidade de codigo. Dada a TAREFA e o DIFF abaixo, avalie o quanto o diff cumpre a tarefa e com que qualidade.',
    'Responda APENAS um JSON em uma linha, sem texto extra: {"score": 0-5, "meets": true ou false, "notes": "uma frase curta"}.',
    'score: 0 (nao cumpre / vazio) a 5 (cumpre com qualidade). meets: o objetivo foi atingido? notes: o essencial em uma frase.',
    '',
    `TAREFA: ${desc}`,
    '',
    'DIFF:',
    diff || '(sem diff vs a base)',
  ].join('\n')
  if (card.fm.id) registrarTier(card.fm.id, 'avaliacao', tierDaAcaoDoCard('avaliacao', card.fm))
  const res = await runProvider(card.fm.id ?? '', provider, { prompt, cwd: ROOT, dirs: [wt], mode: 'readonly', useAgents: false, model: overrideDoVerify ? modelFor('verify', overrideDoVerify) : modeloGovernado('verify', 'avaliacao', card.fm), effort: esforcoGovernado('verify', 'avaliacao', card.fm), expectsJson: true, timeoutMs: 120000 }, 'avaliacao')
  if (!res.ok) {
    return { score: -1, meets: false, notes: `eval NAO rodou: ${String(res.detail || 'provedor falhou').slice(0, 120)}`, cost: res.cost, tokens: sumTokens(res.usage) }
  }
  const tokens = sumTokens(res.usage)
  const m = res.text.match(/\{[\s\S]*?\}/)
  if (m && m[0]) {
    try {
      const j = JSON.parse(m[0]) as { score?: number; meets?: boolean; notes?: string }
      return {
        score: Math.max(0, Math.min(5, Math.round(Number(j.score) || 0))),
        meets: !!j.meets,
        notes: String(j.notes || '').replace(/\s+/g, ' ').slice(0, 240),
        cost: res.cost,
        tokens,
      }
    } catch {
      void 0
    }
  }
  return { score: 0, meets: false, notes: 'eval inconclusivo (sem veredito parseavel)', cost: res.cost, tokens }
}

export type AcaoDoEval = 'corrigir' | 'avisar' | 'nada'

export interface DecisaoDoEval {
  acao: AcaoDoEval
  instrucao: string
}

export function decisaoDoEval(e: EvalResult, fm: Fields, limiar: number, objetivo: string): DecisaoDoEval {
  if (limiar < 0 || e.score < 0 || e.score > limiar) return { acao: 'nada', instrucao: '' }
  if (String(fm.eval_gate ?? '') === 'usado') return { acao: 'avisar', instrucao: '' }
  return {
    acao: 'corrigir',
    instrucao: `eval ${e.score}/5 — ${e.notes}. O diff nao cumpre o objetivo; refaca atendendo: "${objetivo}"`,
  }
}

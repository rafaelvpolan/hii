// Crivo visual — le o screenshot da url renderizada e pergunta ao papel `verify`
// se a mudanca pedida aparece DE FATO e visivelmente na pagina. Morava em
// ciclo/agente.ts; extraido para o crivo (onde vive a verificacao) quando o
// agente estourou o teto anti-monolito de 350 linhas.
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { extractObjetivo } from '../../cordel/index.ts'
import type { Card, VerifyResult } from '../../cordel/index.ts'
import { ROOT } from '../../cordel/alicerce/config.ts'
import { modelFor, providerFor, effortFor } from '../../tomada/registro.ts'
import { runProvider } from '../../euclides/tesouro/confianca.ts'
import { sumTokens } from '../../tomada/uso.ts'

export async function verifyVisual(card: Card, shotPath: string): Promise<VerifyResult> {
  if (!existsSync(shotPath)) return { ok: false, conclusive: false, reason: 'sem screenshot — url nao renderizou (inconclusivo)', cost: 0, tokens: 0 }
  const provider = providerFor('verify')
  if (!provider.supportsVision) return { ok: false, conclusive: false, reason: `provider ${provider.name} nao le imagem — verify visual inconclusivo`, cost: 0, tokens: 0 }
  const desc = extractObjetivo(card.body) || card.fm.title
  const prompt = [
    'Voce e um verificador VISUAL. Use a tool Read para abrir a imagem (screenshot da pagina web renderizada) no caminho abaixo e analise o que aparece.',
    `Imagem: ${shotPath}`,
    `Tarefa que deveria ter sido aplicada: "${desc}"`,
    'A mudanca/elemento pedido aparece DE FATO e visivelmente na pagina? Seja rigoroso. Responda APENAS um JSON em uma linha, sem texto extra: {"ok": true ou false, "reason": "motivo curto"}.',
  ].join('\n')
  const res = await runProvider(card.fm.id ?? '', provider, {
    prompt,
    cwd: ROOT,
    dirs: [dirname(shotPath)],
    mode: 'readonly',
    useAgents: false,
    model: modelFor('verify'),
    effort: effortFor('verify', card.fm.effort),
    expectsJson: true,
    timeoutMs: 120000,
  }, 'verify')
  const tokens = sumTokens(res.usage)
  const inner = res.text.match(/\{[\s\S]*?\}/)
  if (inner && inner[0]) {
    try {
      const v = JSON.parse(inner[0]) as { ok?: boolean; reason?: string }
      return { ok: !!v.ok, conclusive: true, reason: String(v.reason || '').slice(0, 140), cost: res.cost, tokens }
    } catch { void 0 }
  }
  return { ok: false, conclusive: false, reason: 'verify inconclusivo (sem veredito parseavel)', cost: res.cost, tokens }
}

import { isoNow } from '../../cordel/index.ts'
import { patchCard, readCard } from '../../cordel/store.ts'
import { URL_AUTO_OK } from '../../cordel/alicerce/config.ts'

// Crivo — a aprovacao do URL deixa de ser pergunta quando a maquina ja tem a
// resposta. Antes, TODO card em URL esperava o humano escolher "1 abriu e esta
// certo"; o motor ja tinha subido a url, esperado o HTTP 200 e inspecionado a
// pagina — e perguntava mesmo assim. Decisao do dono: url respondendo passa
// sozinha; url que nao responde ou da erro vai para o reparo que ja existe; a
// pergunta so sobra quando nao ha url para checar ou o reparo esgotou.

export interface SinaisDoUrl {
  readonly temUrl: boolean
  readonly respondeu: boolean
  readonly verify: string
}

export interface DecisaoDeUrl {
  readonly aprova: boolean
  readonly motivo: string
}

export function decisaoDeAprovacaoDeUrl(s: SinaisDoUrl, ligado = URL_AUTO_OK): DecisaoDeUrl {
  if (!ligado) return { aprova: false, motivo: 'aprovacao automatica desligada (HICODE_URL_AUTO_OK=off) — a decisao e sua' }
  if (!s.temUrl) return { aprova: false, motivo: 'sem url para checar — a aprovacao da funcionalidade e sua' }
  if (!s.respondeu) return { aprova: false, motivo: 'a url nao respondeu — o reparo automatico nao a colocou no ar' }
  if (s.verify === 'falhou') return { aprova: false, motivo: 'a pagina respondeu com erro e o conserto automatico nao resolveu' }
  if (s.verify === 'ok') return { aprova: true, motivo: 'url respondeu e a inspecao passou' }
  return { aprova: true, motivo: 'url respondeu (HTTP 200); inspecao automatica indisponivel, aprovada pelo alcance' }
}

export function aprovarUrlPeloMotor(id: string, motivo: string): boolean {
  const card = readCard(id)
  if (!card || card.fm.status !== 'URL') return false
  patchCard(id, { status: 'URL_OK' }, `${isoNow()} URL->URL_OK aprovada pelo motor: ${motivo} — para conferir a olho, /serve ${id} mostra a url`)
  return true
}

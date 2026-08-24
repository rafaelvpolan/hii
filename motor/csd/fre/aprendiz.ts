import { eventosDoCard } from '../../euc/eventos'
import { executarComIdempotencia } from '../../qlb/slv/idempotencia'
import { assinar, causaRaizDe, ehFalha } from './assinatura'
import { registrarOcorrencia } from './candidatos'

// FRE — o aprendiz. Roda UMA vez no fechamento do card.
//
// Le o diario, nao o codigo: audita COMO o card se comportou, e nao reescreve a
// solucao nem julga gosto. A evidencia e o trecho do diario que comprova, nunca
// opiniao do modelo — e por isso a extracao e deterministica: agrupa por
// categoria e causa, sem perguntar a ninguem qual e o padrao.
//
// Passa pela chave de idempotencia porque rodar duas vezes dobraria a contagem
// e falsearia o limiar — um card contado em dobro promoveria regra sem ter a
// recorrencia que a justifica.

export const FASE_DO_APRENDIZ = 'fre'
export const OPERACAO_DO_APRENDIZ = 'aprendiz'

export interface ContextoDoAprendiz {
  readonly alvo: string
  readonly dominio: string
}

export interface AssinaturaExtraida {
  readonly assinatura: string
  readonly categoria: string
  readonly evidencia: string
}

export function extrairAssinaturas(card: string, dominio: string): AssinaturaExtraida[] {
  const vistas = new Set<string>()
  const fora: AssinaturaExtraida[] = []
  for (const e of eventosDoCard(card)) {
    const detalhe = e.detalhe ?? ''
    const categoria = e.evento === 'orfao' ? 'risco' : (e.fase ?? '')
    if (!categoria) continue
    if (e.evento !== 'orfao' && !ehFalha(detalhe)) continue
    const assinatura = assinar({
      categoria,
      dominio,
      tipoDeFalha: e.evento,
      causaRaiz: causaRaizDe(detalhe) || e.evento,
    })
    if (vistas.has(assinatura)) continue
    vistas.add(assinatura)
    fora.push({ assinatura, categoria, evidencia: `${e.evento} ${e.fase ?? ''}: ${detalhe}`.trim() })
  }
  return fora
}

export interface FechamentoDoAprendiz {
  readonly reaproveitada: boolean
  readonly assinaturas: readonly string[]
}

export async function aprendizFechaCard(card: string, ctx: ContextoDoAprendiz): Promise<FechamentoDoAprendiz> {
  const extraidas = extrairAssinaturas(card, ctx.dominio)
  const efeito = await executarComIdempotencia({
    card,
    fase: FASE_DO_APRENDIZ,
    operacao: OPERACAO_DO_APRENDIZ,
    executar: async (): Promise<string> => {
      for (const a of extraidas) {
        registrarOcorrencia(ctx.alvo, { assinatura: a.assinatura, categoria: a.categoria, card, evidencia: a.evidencia })
      }
      return `${extraidas.length} assinatura(s)`
    },
    produziuEfeito: () => true,
  })
  return { reaproveitada: efeito.reaproveitada, assinaturas: extraidas.map(a => a.assinatura) }
}

// Troca de provedor por cota com decisao humana: o motor recomenda, o humano decide.
//
// A troca automatica mandava prompt, diff e contexto da sessao para outra IA sem
// perguntar. No modo `perguntar` (padrao de HII_QUOTA_FALLBACK) o roteador continua
// escolhendo o melhor candidato apto, mas o card para em HALTED com a recomendacao
// gravada, e a decisao chega pelo mesmo canal de perguntas da TUI e da API.
import { isoNow } from '../../cordel/index.ts'
import type { Fields } from '../../cordel/index.ts'
import type { ClarifyQuestion } from '../../cordel/tipos.ts'
import { readCard, updateCardPorAcaoHumana } from '../../cordel/store.ts'
import { modoDeTrocaPorCota } from '../../cordel/alicerce/config.ts'
import { campoDeOverrideDoPapel, comTentativaDeRota, decidirRota, rotaTentadas } from '../../tomada/rota.ts'
import type { DecisaoDeRota, EntradaDeRota } from '../../tomada/rota.ts'
import { contextoDaTrocaDeIa } from '../../tomada/rota-log.ts'
import { motivoParaEsperarHarness } from '../../tomada/harness-em-voo.ts'
import type { AgentRole } from '../../tomada/tipos.ts'

const PAPEIS: readonly AgentRole[] = ['implement', 'step', 'gate', 'verify']
const STATUS_DE_RETOMADA: readonly string[] = ['EXECUTING', 'URL_OK', 'CORRECTING', 'SPECCED']

export const RESPOSTA_AGUARDAR = 'Nao trocar; aguardar a cota renovar'

export function respostaTrocar(para: string): string {
  return `Trocar para ${para} e retomar`
}

export interface PedidoDeRecomendacao {
  readonly id: string
  readonly papel?: AgentRole
  readonly provedor: string
  readonly falha: string
  readonly resumeStatus: string
  readonly resumeStep?: string
  readonly rota?: (e: EntradaDeRota) => DecisaoDeRota
}

function papelValido(papel: string | undefined): AgentRole | null {
  return PAPEIS.find(p => p === papel) ?? null
}

export function recomendarTrocaPorCota(p: PedidoDeRecomendacao): Fields | null {
  if (modoDeTrocaPorCota() !== 'perguntar') return null
  const papel = papelValido(p.papel)
  if (!papel) return null
  const tentados = rotaTentadas(readCard(p.id)?.fm.rota_tentados)
  const rota = (p.rota ?? decidirRota)({ papel, classeDeFalha: 'quota', provedorAtual: p.provedor, tentadosNestaRodada: tentados })
  if (rota.acao !== 'trocar') return null
  return {
    troca_recomendada: rota.para,
    troca_de: p.provedor,
    troca_papel: papel,
    troca_motivo: rota.motivo,
    troca_falha: p.falha,
    troca_retomar_em: p.resumeStatus,
    troca_resume_from: p.resumeStep ?? '',
    troca_tentados: comTentativaDeRota(readCard(p.id)?.fm.rota_tentados, p.provedor),
    troca_decidida: '',
  }
}

export function perguntaDeTrocaPorCota(fm: Fields): ClarifyQuestion | null {
  const para = fm.troca_recomendada
  if (fm.status !== 'HALTED' || fm.halt_class !== 'quota' || !para || fm.troca_decidida) return null
  const de = fm.troca_de || 'o provedor atual'
  return {
    q: `A cota de ${de} acabou (${fm.troca_falha || 'cota esgotada'}). Recomendo trocar para ${para}: ${fm.troca_motivo ?? ''}. Trocar e retomar a tarefa?`,
    options: [respostaTrocar(para), RESPOSTA_AGUARDAR],
    recommended: respostaTrocar(para),
  }
}

export interface DecisaoDeTroca {
  readonly ok: boolean
  readonly reason: string
  readonly retomou: boolean
}

function aceitouTrocar(resposta: string, para: string): boolean {
  const texto = resposta.trim()
  return texto === respostaTrocar(para) || /^(sim|s|trocar)\b/i.test(texto)
}

export function decidirTrocaPorCota(id: string, resposta: string): DecisaoDeTroca {
  const fm = readCard(id)?.fm
  if (!fm || !perguntaDeTrocaPorCota(fm)) return { ok: false, reason: `#${id} nao tem troca de provedor pendente`, retomou: false }
  const para = fm.troca_recomendada ?? ''
  const de = fm.troca_de ?? ''
  if (!aceitouTrocar(resposta, para)) {
    updateCardPorAcaoHumana(id, {
      fields: { troca_decidida: 'aguardar' },
      log: `${isoNow()} humano recusou trocar ${de || 'o provedor'} por ${para}; a tarefa segue parada ate a cota renovar ou ate ser retomada`,
    })
    return { ok: true, reason: '', retomou: false }
  }
  const espera = motivoParaEsperarHarness(id)
  if (espera) return { ok: false, reason: espera, retomou: false }
  const papel = papelValido(fm.troca_papel) ?? 'implement'
  const alvo = STATUS_DE_RETOMADA.includes(fm.troca_retomar_em ?? '') ? fm.troca_retomar_em ?? 'EXECUTING' : 'EXECUTING'
  const contexto = contextoDaTrocaDeIa({ id, papel, de, para, falha: fm.troca_falha ?? 'cota esgotada', motivo: fm.troca_motivo ?? '' })
  const escrito = updateCardPorAcaoHumana(id, {
    fields: {
      status: alvo,
      [campoDeOverrideDoPapel(papel)]: para,
      rota_tentados: comTentativaDeRota(fm.troca_tentados || fm.rota_tentados, de),
      rota_contexto: contexto,
      wait_provider: para,
      ...(fm.troca_resume_from ? { resume_from: fm.troca_resume_from } : {}),
      troca_decidida: 'trocar',
    },
    log: `${isoNow()} HALTED->${alvo} humano aceitou trocar ${de || 'o provedor'} por ${para} depois da cota esgotada`,
  })
  return escrito ? { ok: true, reason: '', retomou: true } : { ok: false, reason: `nao foi possivel retomar #${id}`, retomou: false }
}

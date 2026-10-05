// Aviso antecipado de cota: o humano fica sabendo ANTES de a janela acabar, com a
// IA recomendada para a troca, e decide se troca agora (/ia) ou quando a cota
// esgotar (pergunta da tarefa). Uma vez por janela e por card, para nao virar ruido.
import { isoNow } from '../../cordel/index.ts'
import type { PapelDeChamada } from '../../cordel/tipos.ts'
import { patchCard, readCard } from '../../cordel/store.ts'
import { numeroDeEnv } from '../../cordel/alicerce/config.ts'
import { decidirRota } from '../../tomada/rota.ts'
import type { DecisaoDeRota, EntradaDeRota } from '../../tomada/rota.ts'
import type { AgentRole, HarnessId } from '../../tomada/tipos.ts'
import { janelasDoProvedor } from './janelas.ts'
import type { JanelaDeProvedor } from './janelas.ts'
import { publicarEvento } from '../ponte-eventos.ts'

const LIMIAR_PADRAO_PCT = 80
const PAPEIS: readonly AgentRole[] = ['implement', 'step', 'gate', 'verify']

export function limiarDeAvisoDeCota(): number {
  return numeroDeEnv('HII_COTA_AVISO_PCT', LIMIAR_PADRAO_PCT)
}

export function janelaPertoDoLimite(janelas: readonly JanelaDeProvedor[], limiarPct: number = limiarDeAvisoDeCota()): JanelaDeProvedor | null {
  if (limiarPct <= 0) return null
  const perto = janelas.filter(j => j.limiteConfiavel && j.percentualDoLimite !== null && j.percentualDoLimite >= limiarPct && j.restamMs > 0)
  return perto.sort((a, b) => (b.percentualDoLimite ?? 0) - (a.percentualDoLimite ?? 0))[0] ?? null
}

export interface EntradaDeAviso {
  readonly id: string
  readonly provedor: HarnessId
  readonly papel: PapelDeChamada
  readonly janelas?: readonly JanelaDeProvedor[]
  readonly rota?: (e: EntradaDeRota) => DecisaoDeRota
}

export function textoDoAviso(provedor: string, j: JanelaDeProvedor, recomendado: string): string {
  const renova = j.resetaEm ? `, renova em ${j.resetaEm}` : ''
  const troca = recomendado ? `; recomendado para a troca: ${recomendado} (troque agora com /ia ou responda a pergunta quando a cota acabar)` : '; nenhuma outra IA apta para trocar agora'
  return `cota de ${provedor} em ${Math.round(j.percentualDoLimite ?? 0)}% da janela ${j.rotulo}${renova}${troca}`
}

export function avisarCotaPerto(e: EntradaDeAviso): string {
  if (!e.id) return ''
  const fm = readCard(e.id)?.fm
  if (!fm || fm.tipo === 'session') return ''
  const j = janelaPertoDoLimite(e.janelas ?? janelasDoProvedor(e.provedor))
  if (!j) return ''
  const chave = `${e.provedor}:${j.rotulo}:${j.resetaEm}`
  if (fm.cota_aviso_chave === chave) return ''
  const papel = PAPEIS.find(p => p === e.papel) ?? 'implement'
  const rota = (e.rota ?? decidirRota)({ papel, classeDeFalha: 'quota', provedorAtual: e.provedor, tentadosNestaRodada: [] })
  const texto = textoDoAviso(e.provedor, j, rota.acao === 'trocar' ? rota.para : '')
  patchCard(e.id, { cota_aviso: texto, cota_aviso_chave: chave }, `${isoNow()} AVISO: ${texto}`)
  publicarEvento('tarefa_atualizada', e.id, fm.sessao_id ?? '', { mensagem: texto })
  return texto
}

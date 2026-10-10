import { readFileSync } from 'node:fs'
import type { Card } from '../cordel/tipos.ts'
import { localidadeDeExecucao } from '../cordel/alicerce/config.ts'
import { anexarEvento } from '../euclides/eventos.ts'
import { preferenciaDoPapel } from './preferencias.ts'
import { consultaReal } from './rota.ts'
import type { ConsultaDeRota } from './rota.ts'
import { providerNameFor } from './registro.ts'
import type { AgentRole } from './tipos.ts'

export type Dificuldade = 'simples' | 'padrao' | 'complexa'
export interface PoliticaDeEtapa {
  versao: 1
  rotas: { papel: AgentRole; dificuldade: Dificuldade; provedores: string[] }[]
}
export interface EscolhaDeEtapa { provedor: string; motivo: string; dificuldade: Dificuldade }

// Heuristica conservadora: nao substitui o tier nem reduz gates de risco.
export function dificuldadeDaEtapa(card: Card, feedback = ''): Dificuldade {
  if (card.fm.risk === 'high' || card.fm.lei_forcou === 'completo' || feedback.trim()) return 'complexa'
  const texto = `${card.fm.title ?? ''} ${card.body}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(auth\w*|seguranca|migration\w*|migracao|arquitet\w*|pagamento\w*|concorrencia)\b/.test(texto)) return 'complexa'
  if (/\b(typo|ortografia|readme|documentacao)\b/.test(texto) && !/\b(bug|api|logica|feature|refator\w*)\b/.test(texto)) return 'simples'
  return 'padrao'
}

export function validarPoliticaDeEtapa(p: PoliticaDeEtapa): PoliticaDeEtapa {
  if (!p || p.versao !== 1 || !Array.isArray(p.rotas)) throw new Error('politica de etapas invalida')
  const vistas = new Set<string>()
  for (const r of p.rotas) {
    if (!r || !['implement', 'step', 'verify', 'gate'].includes(r.papel)
      || !['simples', 'padrao', 'complexa'].includes(r.dificuldade)
      || !Array.isArray(r.provedores) || !r.provedores.length
      || r.provedores.some(v => typeof v !== 'string' || !v.trim())
      || new Set(r.provedores).size !== r.provedores.length) throw new Error('rota de etapa invalida')
    const chave = `${r.papel}:${r.dificuldade}`
    if (vistas.has(chave)) throw new Error(`rota de etapa duplicada: ${chave}`)
    vistas.add(chave)
  }
  return p
}

export function escolherEtapa(papel: AgentRole, dificuldade: Dificuldade, politica: PoliticaDeEtapa,
  consulta: ConsultaDeRota, requisitos: { visual?: boolean; mcp?: boolean; somenteLocal?: boolean } = {}): EscolhaDeEtapa | null {
  const rota = validarPoliticaDeEtapa(politica).rotas.find(r => r.papel === papel && r.dificuldade === dificuldade)
  for (const nome of rota?.provedores ?? []) {
    const c = consulta.candidato(nome)
    if (!c || !c.autenticado || c.cotaEsgotada) continue
    if ((papel === 'implement' || papel === 'step') && !c.agentic) continue
    if ((papel === 'gate' || papel === 'verify') && (!c.isolaLeitura || !c.emitsStructuredJson)) continue
    if (requisitos.visual && !c.supportsVision) continue
    if (requisitos.mcp && !c.mcp) continue
    if (requisitos.somenteLocal && (!c.rodaLocal || c.inferenciaLocalVerificada === false)) continue
    return { provedor: nome, dificuldade, motivo: `politica por etapa: ${papel}/${dificuldade}; primeiro candidato apto` }
  }
  return null
}

// Politica explicita, sem inventar custo/qualidade de CLIs por assinatura.
// Escolhas humanas e atribuicoes de microtasks sempre prevalecem.
export function roteamentoDaEtapa(card: Card, papel: AgentRole, feedback = '', visual = false, mcp = false): string | undefined {
  const override = card.fm[`provider_override_${papel}`] || undefined
  const preferencia = preferenciaDoPapel(papel)
  if (override || preferencia.provider || preferencia.model || (papel === 'implement' && card.fm.orq_modelo)) return override
  const caminho = process.env.HII_STEP_ROUTING_CONFIG
  if (!caminho) return undefined
  const politica = validarPoliticaDeEtapa(JSON.parse(readFileSync(caminho, 'utf8')) as PoliticaDeEtapa)
  const dificuldade = dificuldadeDaEtapa(card, feedback)
  const escolha = escolherEtapa(papel, dificuldade, politica, consultaReal(), { visual, mcp, somenteLocal: localidadeDeExecucao() === 'somente_local' })
  if (card.fm.id) anexarEvento({ card: card.fm.id, evento: 'step_route_selected', fase: papel,
    chave: card.fm.orq_microtask || papel, resultado: escolha?.provedor ?? providerNameFor(papel),
    detalhe: escolha?.motivo ?? `sem candidato apto para ${dificuldade}; preservada politica atual` })
  return escolha?.provedor
}

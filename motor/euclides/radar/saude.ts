import type { ClasseDeEspera, ClasseDeParada, Fields } from '../../cordel/index.ts'
import { ehClasseDeEspera, ehClasseDeParada, isoAt, PARADA_SEM_CLASSE } from '../../cordel/index.ts'
import { allCards } from '../../cordel/store.ts'
import { maxWaitingAttempts } from '../../cordel/alicerce/config.ts'
import { CLASSE_DE_ESPERA_PADRAO, backoffMsFor } from '../../ciclo/reprise/politica.ts'
import { readDaemonHealth } from './tick.ts'
import { isActive } from '../../mirante/render/phases.ts'
import { PROVEDOR_DESCONHECIDO, lerCota } from '../tesouro/cota.ts'
import type { LeituraDeCota } from '../tesouro/cota.ts'

export type EstadoDoMotor = 'tick-falhando' | 'cota-esgotada' | 'esperando-provedor' | 'parado' | 'trabalhando' | 'ocioso'

// Os estados que o motor NAO tira sozinho. `PR_OPEN` fica de fora porque TEM
// consumidor automatico (quilombo/cartorio/merge.ts, a cada 30 s), e `WAITING` tambem
// (ciclo/reprise/espera.ts o acorda).
//
// Nao vem de `checkpointsHumanos` em config/topologia.json de proposito: aquela lista
// declara ["URL","CONFIRM","PR_OPEN"] — inclui PR_OPEN, que tem consumidor, e omite
// READY, CLARIFY e PAUSED, que nao tem. Corrigi-la mexe no invariante de
// test/niemeyer/topologia.test.ts:126, e e item proprio em PENDENCIAS.md.
const SEM_CONSUMIDOR_AUTOMATICO: readonly string[] = ['READY', 'CLARIFY', 'PAUSED', 'CONFIRM', 'URL']

export interface EsperaPorFalha {
  card: string
  titulo: string
  provedor: string
  provedorIdentificado: boolean
  motivo: string
  tentativas: number
  maxTentativas: number
  esperandoDesde: string
  proximaTentativaEm: string
  atrasoMs: number
}

export interface ProvedorIndisponivel {
  provedor: string
  provedorIdentificado: boolean
  desde: string
  motivo: string
  cardsEsperando: string[]
  cardsParados: string[]
  limiteDeCota: boolean
}

// `desdeConhecido` segue o padrao de `provedorIdentificado` acima: card gravado antes
// de `halt_at`/`status_since` existirem nao tem idade mensuravel, e devolver zero
// afirmaria "parou agora". Leia o booleano antes do numero.
export interface ParadaDeCard {
  card: string
  titulo: string
  classe: ClasseDeParada
  motivo: string
  desde: string
  desdeConhecido: boolean
  idadeMs: number
}

export interface CheckpointAberto {
  card: string
  titulo: string
  estado: string
  desde: string
  desdeConhecido: boolean
  idadeMs: number
}

export interface SaudeDoTick {
  falhasSeguidas: number
  ultimoErro: string
  ultimoErroEm: string
}

export interface SaudeDoMotor {
  estado: EstadoDoMotor
  esperas: EsperaPorFalha[]
  provedoresIndisponiveis: ProvedorIndisponivel[]
  paradosPorCota: string[]
  // Toda parada, de qualquer classe. `provedoresIndisponiveis` acima so enxerga
  // `quota` e `transient`, porque e um mapa de indisponibilidade de PROVEDOR — parada
  // por orcamento, escopo, excecao ou por voce nao pertence a ele, e era assim que o
  // card 002 sumia da leitura de saude inteira.
  paradas: ParadaDeCard[]
  esperandoVoce: CheckpointAberto[]
  tick: SaudeDoTick
  cota: LeituraDeCota
}

function texto(fm: Fields, campo: string): string {
  return String(fm[campo] ?? '').trim()
}

// Precisa da classe: desde que o backoff tem piso por classe, somar a escada nua
// devolveria um inicio de espera ADIANTADO para todo card que esperou por timeout —
// e "esperando desde" e o numero que o operador usa para decidir se intervem.
function somaDosBackoffs(tentativas: number, classe: ClasseDeEspera): number {
  let total = 0
  for (let i = 1; i <= tentativas; i += 1) total += backoffMsFor(i, classe)
  return total
}

function classeDaEspera(fm: Fields): ClasseDeEspera {
  const gravada = texto(fm, 'wait_class')
  return ehClasseDeEspera(gravada) ? gravada : CLASSE_DE_ESPERA_PADRAO
}

function inicioDaEsperaMs(fm: Fields, proximaMs: number, tentativas: number, agoraMs: number): number {
  const ancora = Number.isFinite(proximaMs) ? proximaMs : (Date.parse(texto(fm, 'updated')) || agoraMs)
  return Math.min(ancora - somaDosBackoffs(tentativas, classeDaEspera(fm)), agoraMs)
}

function esperaDoCard(fm: Fields, agoraMs: number): EsperaPorFalha {
  const provedor = texto(fm, 'wait_provider')
  const tentativas = Number(texto(fm, 'wait_attempts')) || 0
  const proximaMs = Date.parse(texto(fm, 'wait_until'))
  const valida = Number.isFinite(proximaMs)
  return {
    card: texto(fm, 'id'),
    titulo: texto(fm, 'title'),
    provedor: provedor || PROVEDOR_DESCONHECIDO,
    provedorIdentificado: provedor !== '',
    motivo: texto(fm, 'wait_reason'),
    tentativas,
    maxTentativas: maxWaitingAttempts(),
    esperandoDesde: isoAt(inicioDaEsperaMs(fm, proximaMs, tentativas, agoraMs)),
    proximaTentativaEm: valida ? isoAt(proximaMs) : '',
    atrasoMs: valida ? Math.max(0, agoraMs - proximaMs) : 0,
  }
}

function vazio(provedor: string, identificado: boolean): ProvedorIndisponivel {
  return { provedor, provedorIdentificado: identificado, desde: '', motivo: '', cardsEsperando: [], cardsParados: [], limiteDeCota: false }
}

function registrar(mapa: Map<string, ProvedorIndisponivel>, provedor: string, identificado: boolean): ProvedorIndisponivel {
  const atual = mapa.get(provedor) ?? vazio(provedor, identificado)
  mapa.set(provedor, atual)
  return atual
}

function anteciparDesde(alvo: ProvedorIndisponivel, quando: string, motivo: string): void {
  if (!quando) return
  if (!alvo.desde || quando < alvo.desde) {
    alvo.desde = quando
    if (motivo) alvo.motivo = motivo
  }
}

function porEsperas(mapa: Map<string, ProvedorIndisponivel>, esperas: EsperaPorFalha[]): void {
  for (const e of esperas) {
    const alvo = registrar(mapa, e.provedor, e.provedorIdentificado)
    alvo.cardsEsperando.push(e.card)
    anteciparDesde(alvo, e.esperandoDesde, e.motivo)
  }
}

function porHalts(mapa: Map<string, ProvedorIndisponivel>, cards: Fields[]): string[] {
  const paradosPorCota: string[] = []
  for (const fm of cards) {
    if (texto(fm, 'status') !== 'HALTED') continue
    const classe = texto(fm, 'halt_class')
    if (classe !== 'quota' && classe !== 'transient') continue
    const provedor = texto(fm, 'halt_provider')
    const alvo = registrar(mapa, provedor || PROVEDOR_DESCONHECIDO, provedor !== '')
    alvo.cardsParados.push(texto(fm, 'id'))
    if (classe === 'quota') {
      alvo.limiteDeCota = true
      paradosPorCota.push(texto(fm, 'id'))
    }
    anteciparDesde(alvo, texto(fm, 'halt_at') || texto(fm, 'updated'), texto(fm, 'halt_reason'))
  }
  return paradosPorCota
}

function porCota(mapa: Map<string, ProvedorIndisponivel>, cota: LeituraDeCota, haltados: Set<string>): string[] {
  const semMarcacao: string[] = []
  for (const uso of cota.provedores) {
    if (!uso.limiteAtingido) continue
    const alvo = registrar(mapa, uso.provedor, uso.provedorIdentificado)
    alvo.limiteDeCota = true
    anteciparDesde(alvo, uso.limiteAtingidoEm, uso.limiteMotivo)
    for (const card of uso.cardsNoLimite) {
      if (!haltados.has(card) || alvo.cardsParados.includes(card)) continue
      alvo.cardsParados.push(card)
      semMarcacao.push(card)
    }
  }
  return semMarcacao
}

function idade(desde: string, agoraMs: number): Pick<ParadaDeCard, 'desde' | 'desdeConhecido' | 'idadeMs'> {
  const ms = Date.parse(desde)
  if (!desde || !Number.isFinite(ms)) return { desde: '', desdeConhecido: false, idadeMs: 0 }
  return { desde, desdeConhecido: true, idadeMs: Math.max(0, agoraMs - ms) }
}

function paradaDoCard(fm: Fields, agoraMs: number): ParadaDeCard {
  const classe = texto(fm, 'halt_class')
  return {
    card: texto(fm, 'id'),
    titulo: texto(fm, 'title'),
    // `halt_at` primeiro, `status_since` como segunda opcao: os dois nascem na mesma
    // escrita hoje, mas card parado antes desta mudanca tem os dois vazios — e o
    // fallback NAO desce para `updated`, que e reescrito em todo patchCard e daria
    // "parado ha dois minutos" para um card parado ha uma semana.
    classe: ehClasseDeParada(classe) ? classe : PARADA_SEM_CLASSE,
    motivo: texto(fm, 'halt_reason'),
    ...idade(texto(fm, 'halt_at') || texto(fm, 'status_since'), agoraMs),
  }
}

function checkpointDoCard(fm: Fields, agoraMs: number): CheckpointAberto {
  return {
    card: texto(fm, 'id'),
    titulo: texto(fm, 'title'),
    estado: texto(fm, 'status'),
    ...idade(texto(fm, 'status_since'), agoraMs),
  }
}

function estadoMaisGrave(tick: SaudeDoTick, paradosPorCota: string[], esperas: EsperaPorFalha[], paradas: ParadaDeCard[], emVoo: boolean): EstadoDoMotor {
  if (tick.falhasSeguidas > 0) return 'tick-falhando'
  if (paradosPorCota.length) return 'cota-esgotada'
  if (esperas.length) return 'esperando-provedor'
  // Antes de `paradas` existir, este ramo nao existia: card parado por orcamento,
  // escopo, excecao ou por decisao humana caia direto no ternario abaixo e o motor
  // respondia 'ocioso'. Ocioso e "nao tenho o que fazer"; parado e "tenho e nao
  // consigo" — e vem ANTES de 'trabalhando' porque um card devolvido a voce nao para
  // de precisar de voce so porque outro card esta rodando.
  if (paradas.length) return 'parado'
  return emVoo ? 'trabalhando' : 'ocioso'
}

export function lerSaudeDoMotor(agoraMs: number = Date.now()): SaudeDoMotor {
  const cards = allCards()
  const cota = lerCota(agoraMs)
  const esperas = cards
    .filter(c => texto(c, 'status') === 'WAITING')
    .map(c => esperaDoCard(c, agoraMs))
    .sort((a, b) => Number(a.card) - Number(b.card))
  const mapa = new Map<string, ProvedorIndisponivel>()
  porEsperas(mapa, esperas)
  const haltados = new Set(cards.filter(c => texto(c, 'status') === 'HALTED').map(c => texto(c, 'id')))
  const marcados = porHalts(mapa, cards)
  const paradosPorCota = [...new Set([...marcados, ...porCota(mapa, cota, haltados)])]
  const paradas = cards
    .filter(c => texto(c, 'status') === 'HALTED')
    .map(c => paradaDoCard(c, agoraMs))
    .sort((a, b) => Number(a.card) - Number(b.card))
  const esperandoVoce = cards
    .filter(c => SEM_CONSUMIDOR_AUTOMATICO.includes(texto(c, 'status')))
    .map(c => checkpointDoCard(c, agoraMs))
    .sort((a, b) => b.idadeMs - a.idadeMs)
  const daemon = readDaemonHealth()
  const tick: SaudeDoTick = {
    falhasSeguidas: daemon.consecutiveFailures,
    ultimoErro: daemon.lastError,
    ultimoErroEm: daemon.lastErrorAt,
  }
  const emVoo = cards.some(c => {
    const status = texto(c, 'status')
    return status !== 'WAITING' && isActive(status)
  })
  return {
    estado: estadoMaisGrave(tick, paradosPorCota, esperas, paradas, emVoo),
    esperas,
    provedoresIndisponiveis: [...mapa.values()].sort((a, b) => a.provedor.localeCompare(b.provedor)),
    paradosPorCota,
    paradas,
    esperandoVoce,
    tick,
    cota,
  }
}

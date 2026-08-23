import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../cdl'
import { cardsDir } from '../cdl/ali/config'

// EUC — Euclides. Diario append-only de execucao: registra o que aconteceu, em
// ordem, e NUNCA reescreve. E daqui que a retomada apos crash reconstroi onde
// cada card parou (motor/euc/recuperar.ts) e daqui que a idempotencia sabe se
// um efeito ja foi produzido (motor/qlb/slv/idempotencia.ts).
//
// Distinto do ledger de chamada de IA (.ias.jsonl, motor/euc/ias-da-sessao.ts):
// aquele mede custo por chamada; este registra fase e efeito.
export const TIPOS_DE_EVENTO = [
  'fase_inicio',
  'fase_fim',
  'gate_start',
  'gate_verdict',
  'repair_attempt',
  'human_checkpoint',
  'efeito_registrado',
  'orfao',
  'card_fechado',
] as const

export type TipoDeEvento = (typeof TIPOS_DE_EVENTO)[number]

export interface EventoDoCard {
  readonly ts: string
  readonly card: string
  readonly evento: TipoDeEvento
  readonly fase?: string
  readonly chave?: string
  readonly resultado?: string
  readonly detalhe?: string
}

const SUFIXO = '.eventos.jsonl'

export function arquivoDeEventos(card: string): string {
  return join(cardsDir(), 'runs', `${card}${SUFIXO}`)
}

// Le UM byte, o ultimo. Antes isto decodificava o arquivo inteiro em UTF-8 a
// cada escrita, so para olhar o final: com o diario crescendo a cada evento,
// N escritas viravam O(N^2). Medido: 50k eventos levavam 14,3s no total contra
// custo constante aqui. Um card real gera dezenas de eventos, entao nunca doeu
// na pratica — mas nao ha rotacao de diario, e o custo so cresce.
function precisaFecharLinha(caminho: string): boolean {
  if (!existsSync(caminho)) return false
  const tamanho = statSync(caminho).size
  if (tamanho === 0) return false
  const fd = openSync(caminho, 'r')
  try {
    const ultimo = Buffer.alloc(1)
    readSync(fd, ultimo, 0, 1, tamanho - 1)
    return ultimo[0] !== 0x0a
  } finally {
    closeSync(fd)
  }
}

export function anexarEvento(e: Omit<EventoDoCard, 'ts'>): EventoDoCard {
  const registro: EventoDoCard = { ts: isoNow(), ...e }
  const dir = join(cardsDir(), 'runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // appendFileSync: o diario cresce, nunca e reescrito. Uma correcao vira
  // linha nova dizendo que a anterior estava errada — jamais edicao.
  //
  // O \n na frente quando o arquivo termina sem quebra: um crash no meio de uma
  // escrita deixa meia linha no fim, e sem isto o PROXIMO evento colaria nela e
  // os dois se perderiam na leitura. Perder o evento seguinte a um crash e
  // perder exatamente o dado de que a retomada depende.
  const caminho = arquivoDeEventos(e.card)
  appendFileSync(caminho, `${precisaFecharLinha(caminho) ? '\n' : ''}${JSON.stringify(registro)}\n`)
  return registro
}

interface EventoCru {
  ts?: string
  card?: string
  evento?: string
  fase?: string
  chave?: string
  resultado?: string
  detalhe?: string
}

function ehTipo(v: string | undefined): v is TipoDeEvento {
  return v !== undefined && (TIPOS_DE_EVENTO as readonly string[]).includes(v)
}

export function eventosDoCard(card: string): EventoDoCard[] {
  const caminho = arquivoDeEventos(card)
  if (!existsSync(caminho)) return []
  const fora: EventoDoCard[] = []
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const t = linha.trim()
    if (!t) continue
    let cru: EventoCru
    // Linha corrompida nao derruba a retomada: o diario e append-only e um
    // crash no meio de uma escrita pode deixar meia linha no fim do arquivo.
    try { cru = JSON.parse(t) as EventoCru } catch { continue }
    if (!ehTipo(cru.evento) || typeof cru.ts !== 'string' || typeof cru.card !== 'string') continue
    fora.push({
      ts: cru.ts,
      card: cru.card,
      evento: cru.evento,
      fase: cru.fase,
      chave: cru.chave,
      resultado: cru.resultado,
      detalhe: cru.detalhe,
    })
  }
  return fora
}

export function ultimoEvento(card: string): EventoDoCard | null {
  const todos = eventosDoCard(card)
  return todos[todos.length - 1] ?? null
}

export function eventoPorChave(card: string, chave: string): EventoDoCard | undefined {
  return eventosDoCard(card).find(e => e.evento === 'efeito_registrado' && e.chave === chave)
}

export function cardsComDiario(): string[] {
  const dir = join(cardsDir(), 'runs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith(SUFIXO)).map(f => f.slice(0, -SUFIXO.length)).sort()
}

export function cardFechado(card: string): boolean {
  return eventosDoCard(card).some(e => e.evento === 'card_fechado')
}

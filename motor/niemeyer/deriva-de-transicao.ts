import { lerTopologia, transicaoPermitida } from './topologia.ts'
import type { Topologia } from './topologia.ts'
import { STATUSES } from '../cordel/index.ts'
import { anexarEvento } from '../euclides/eventos.ts'
import type { Status } from '../cordel/index.ts'

// Niemeyer — a topologia deixa de ser FOTO e passa a ser OBSERVADA.
//
// O invariante anterior comparava so o DESTINO: "todo estado que o motor escreve
// e destino de alguma transicao declarada". Com HALTED e PAUSED em
// `sempreAlcancavel` e todo estado do pipeline sendo destino de algo, ele nao
// podia reprovar nada — e o motor executava transicoes que a topologia nao
// declara, algumas em todo reinicio de daemon. Comparar par (origem, destino)
// por texto-fonte tambem nao resolve: a maior parte das escritas de status nao
// escreve o par no log.
//
// Entao a comparacao acontece onde o par EXISTE de verdade: no unico ponto de
// escrita do card, que conhece o estado anterior e o novo. Aqui nao se barra
// nada — barrar em producao trocaria deriva silenciosa por card travado. Registra.

export interface Deriva {
  readonly de: Status
  readonly para: Status
  // O card em que a deriva aconteceu, quando quem escreveu soube dizer.
  readonly card?: string
}

const vistas = new Set<string>()
let topo: Topologia | null = null
let ouvinte: ((d: Deriva) => void) | null = null

// `Fields` e Record<string, string>, entao o valor que chega aqui e string ou
// undefined — nunca precisa de `unknown`.
function ehStatus(v: string | undefined): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v)
}

// Ler o JSON a cada escrita de card seria caro num caminho quente; ler uma vez e
// nunca mais impediria o teste de trocar a topologia. `esquecerTopologia` existe
// para o teste, e o custo em producao continua sendo uma leitura por processo.
export function esquecerTopologia(): void {
  topo = null
  vistas.clear()
}

export function observarDeriva(f: ((d: Deriva) => void) | null): void {
  ouvinte = f
}

export function conferirTransicao(de: string | undefined, para: string | undefined, card = ''): Deriva | null {
  if (!ehStatus(de) || !ehStatus(para) || de === para) return null
  try {
    topo ??= lerTopologia()
  } catch {
    // Topologia ilegivel e problema de quem a le para valer (lerTopologia lanca
    // para o chamador dele). Aqui nao pode virar excecao: seria uma escrita de
    // card falhando por causa de um arquivo de auditoria.
    return null
  }
  if (transicaoPermitida(topo, de, para)) return null
  const d: Deriva = card ? { de, para, card } : { de, para }
  const chave = `${de}->${para}`
  if (!vistas.has(chave)) {
    vistas.add(chave)
    process.stderr.write(`[hicode] transicao NAO DECLARADA em config/topologia.json: ${chave} — a topologia envelheceu ou o motor derivou\n`)
  }
  // O diario do card, e nao so o stderr: o dedup acima e por PROCESSO, e um `hii`
  // de linha de comando morre em segundos levando o aviso com ele. No diario a
  // deriva fica auditavel depois.
  if (card) {
    try {
      anexarEvento({ card, evento: 'transicao_nao_declarada', chave, detalhe: 'a topologia envelheceu ou o motor derivou' })
    } catch {
      // Registrar a deriva nao pode impedir a escrita do card que a produziu.
      void 0
    }
  }
  ouvinte?.(d)
  return d
}

export function derivasVistas(): string[] {
  return [...vistas].sort()
}

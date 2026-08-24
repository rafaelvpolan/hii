import { anexarEvento, eventoPorChave } from '../../euc/eventos.ts'

// SLV — Salvo-conduto. "Este ja foi liberado, nao revista de novo."
//
// Toda operacao que fala com o mundo FORA do processo do hii — abrir PR,
// disparar webhook, notificar humano — passa por aqui. Operacao so de leitura
// (rodar teste, ler diff) nao precisa: repetir nao duplica nada.
//
// A regra que faz isso valer: grava ANTES de considerar a operacao concluida.
// Gravar depois e o bug de sempre — o processo morre no meio e o retry produz
// o efeito duas vezes.
//
// O resultado guardado e sempre string: os efeitos reais deste motor devolvem
// url de PR, sha de commit, id de notificacao. Quem precisar de estrutura
// serializa em JSON e desserializa do outro lado — explicito, sem cast cego.

export interface OperacaoComEfeito {
  readonly card: string
  readonly fase: string
  readonly operacao: string
  readonly executar: () => Promise<string>
  // Um efeito que NAO aconteceu nao pode ser registrado como produzido: se
  // fosse, o retry devolveria o fracasso guardado para sempre e a operacao
  // nunca mais seria tentada. Default: string vazia = nao aconteceu.
  readonly produziuEfeito?: (resultado: string) => boolean
}

export interface ResultadoIdempotente {
  readonly resultado: string
  // true = o efeito ja constava no diario e NAO foi produzido de novo
  readonly reaproveitada: boolean
}

// Composta e legivel de proposito, em vez de hash: o diario e lido por humano
// quando um card trava, e `023:ctr:pr_create` diz o que aconteceu — um hash
// hexadecimal nao diz.
export function chaveDeEfeito(card: string, fase: string, operacao: string): string {
  return `${card}:${fase}:${operacao}`
}

export async function executarComIdempotencia(op: OperacaoComEfeito): Promise<ResultadoIdempotente> {
  const chave = chaveDeEfeito(op.card, op.fase, op.operacao)
  const jaFeita = eventoPorChave(op.card, chave)
  if (jaFeita) return { resultado: jaFeita.resultado ?? '', reaproveitada: true }

  const resultado = await op.executar()
  const aconteceu = op.produziuEfeito ? op.produziuEfeito(resultado) : resultado !== ''
  if (!aconteceu) return { resultado, reaproveitada: false }
  anexarEvento({
    card: op.card,
    evento: 'efeito_registrado',
    fase: op.fase,
    chave,
    resultado,
    detalhe: op.operacao,
  })
  return { resultado, reaproveitada: false }
}

export function efeitoJaProduzido(card: string, fase: string, operacao: string): string | undefined {
  return eventoPorChave(card, chaveDeEfeito(card, fase, operacao))?.resultado
}

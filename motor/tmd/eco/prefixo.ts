// ECO — reuso. Prefixo estavel de prompt dentro do mesmo card.
//
// Preocupacao de CUSTO, nao de qualidade — nao confundir com TJL
// (motor/nmy/tjl/blocos.ts), que existe para nao pagar por geracao
// desperdicada. Aqui o ganho vem do cache de prefixo do provedor: quando o
// inicio do prompt bate BYTE A BYTE com a chamada anterior, a entrada cacheada
// sai muito mais barata (a DeepSeek documenta ate 30x).
//
// A condicao que costuma passar despercebida: byte-identico. Reordenar uma
// lista, reescrever uma frase ou recalcular um timestamp no prefixo ja mata o
// cache — e o prompt continua "parecendo igual" para quem le.

export interface PromptDeCard {
  // Montado uma vez por card. Nunca muda depois — nem para corrigir.
  readonly prefixo: string
  // Cresce por anexo. Cada conserto estreito e um sufixo novo.
  readonly sufixos: readonly string[]
}

export function abrirPrompt(prefixo: string): PromptDeCard {
  return { prefixo, sufixos: [] }
}

// Anexa, nunca reescreve. Uma correcao vira linha nova dizendo que a anterior
// estava errada — mesma disciplina do diario append-only (EUC).
export function anexarInstrucao(p: PromptDeCard, instrucao: string): PromptDeCard {
  return { prefixo: p.prefixo, sufixos: [...p.sufixos, instrucao] }
}

export function montar(p: PromptDeCard): string {
  return p.sufixos.length ? `${p.prefixo}\n${p.sufixos.join('\n')}` : p.prefixo
}

// O que precisa bater byte a byte entre chamadas para o cache do provedor valer.
export function prefixoEstavel(p: PromptDeCard): string {
  return p.prefixo
}

export interface DivergenciaDePrefixo {
  readonly estavel: boolean
  readonly posicao: number
}

// Guarda para teste e para quem for montar prompt em outro lugar: compara dois
// prompts do mesmo card e diz se o prefixo sobreviveu intacto, e onde quebrou.
export function conferirPrefixo(anterior: string, atual: string): DivergenciaDePrefixo {
  const limite = Math.min(anterior.length, atual.length)
  for (let i = 0; i < limite; i++) {
    if (anterior[i] !== atual[i]) return { estavel: false, posicao: i }
  }
  // Prefixo intacto e o novo apenas cresceu: e exatamente o caso que o cache
  // do provedor aproveita.
  if (atual.length >= anterior.length) return { estavel: true, posicao: -1 }
  return { estavel: false, posicao: limite }
}

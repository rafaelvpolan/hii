// Freire — Freire. Aprender do que aconteceu, nao do que alguem achou que aconteceu.
//
// A assinatura agrupa o MESMO problema visto em cards diferentes. Duas decisoes
// que ela carrega:
//
// LEGIVEL, nao hash hexadecimal. O plano dizia hash(dominio+falha+causa), mas o
// candidato e lido por humano na revisao em lote, e o proprio exemplo do plano
// usa nome legivel no arquivo. Mesmo motivo de chaveDeEfeito em Salvo-conduto: hash nao
// conta o que aconteceu.
//
// NORMALIZADA, mas nao demais. Caixa, acento e pontuacao nao podem criar duas
// assinaturas para a mesma causa — senao o limiar nunca fecha. Mas causa raiz
// diferente TEM de dar assinatura diferente: agrupar demais esconde o problema
// atras de um padrao generico que nenhuma regra consegue cobrar.

export interface CausaDoProblema {
  readonly categoria: string
  readonly dominio: string
  readonly tipoDeFalha: string
  readonly causaRaiz: string
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

const CAMPOS: readonly (keyof CausaDoProblema)[] = ['categoria', 'dominio', 'tipoDeFalha', 'causaRaiz']

export function assinar(causa: CausaDoProblema): string {
  const partes: string[] = []
  for (const campo of CAMPOS) {
    const valor = normalizar(causa[campo] ?? '')
    if (!valor) throw new Error(`assinatura sem ${campo} — agruparia problemas nao relacionados sob o mesmo padrao`)
    partes.push(valor)
  }
  return partes.join('-').slice(0, 120)
}

const FALHOU = /\b(?:falhou|reprovou|reprovado|blocked|erro|incompleto)\b/i

export function ehFalha(detalhe: string): boolean {
  return FALHOU.test(detalhe)
}

export function causaRaizDe(detalhe: string): string {
  const depoisDoStatus = detalhe.split(':').slice(1).join(':').trim()
  return depoisDoStatus || detalhe.trim()
}

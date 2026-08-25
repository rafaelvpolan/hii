import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cdl/ali/config.ts'
import type { ClarifyQuestion, Fields } from '../../cdl/tipos.ts'

// O crivo pergunta ao humano — e ate aqui ninguem ouvia.
//
// `persistGate` grava `review_questions` no card, e o motor inteiro nao tinha UM
// leitor: `grep review_questions motor/` devolvia so a escrita. O outro destino era
// `buildPrBody`, que so existe se o PR abrir — o card 001 parou em HALTED com tres
// perguntas do crivo dentro do frontmatter e nada na tela.
//
// A pendencia da TUI para HALTED dizia "a tarefa parou — enter retoma", sem
// mencionar que havia pergunta. Quem opera nao tinha como saber que existia algo
// para responder, muito menos como responder.
//
// As respostas ficam ao lado das do CLARIFY (`runs/<id>.clarify.json`), no mesmo
// formato, para a superficie de resposta ser a MESMA: setas, numero, texto livre.
// Duas superficies para a mesma coisa seria o segundo lugar para o defeito voltar.

export function arquivoDeRevisao(id: string): string {
  return join(cardsDir(), 'runs', `${id}.review.json`)
}

export function lerPerguntasDoCrivo(id: string): ClarifyQuestion[] {
  const f = arquivoDeRevisao(id)
  if (!existsSync(f)) return []
  try {
    const parsed = JSON.parse(readFileSync(f, 'utf8')) as ClarifyQuestion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function gravarPerguntasDoCrivo(id: string, perguntas: readonly ClarifyQuestion[]): void {
  const dir = join(cardsDir(), 'runs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(arquivoDeRevisao(id), JSON.stringify(perguntas, null, 2))
}

// Opcoes fixas: a pergunta do crivo e sempre sobre EVIDENCIA — "isto foi feito, ou
// so parece ter sido?". "sim"/"nao" cobrem o caso comum com uma tecla, e o texto
// livre continua valendo para o que nao cabe neles. Sem opcao alguma, responder
// exigiria digitar frase inteira tres vezes.
const OPCOES = ['sim', 'nao', 'nao sei — investigue antes de seguir'] as const

function comoPergunta(texto: string): ClarifyQuestion {
  return { q: texto, options: [...OPCOES], recommended: '' }
}

// O card e a fonte da VERDADE sobre quais perguntas existem (o crivo as escreveu
// la); o arquivo guarda as RESPOSTAS. Ler dos dois e o que faz uma rodada nova do
// crivo, com perguntas diferentes, nao herdar resposta de pergunta que nao existe
// mais — e nao perder a resposta de pergunta que continua a mesma.
export function perguntasDoCrivo(fm: Fields, id: string): ClarifyQuestion[] {
  const bruto = String(fm.review_questions ?? '')
  if (!bruto) return []
  let textos: string[]
  try {
    // `string[]` e nao `unknown`: o `Array.isArray` abaixo e a checagem de verdade,
    // e o `String(q)` sobrevive a elemento que nao seja string. Um `as unknown` aqui
    // seria so ruido — o formato ja e conferido em execucao.
    const parsed = JSON.parse(bruto) as string[]
    textos = Array.isArray(parsed) ? parsed.map(q => String(q)).filter(Boolean) : []
  } catch {
    return []
  }
  if (!textos.length) return []
  const respondidas = new Map(lerPerguntasDoCrivo(id).map(q => [q.q, q.answer ?? '']))
  return textos.map(t => {
    const anterior = respondidas.get(t)
    return anterior ? { ...comoPergunta(t), answer: anterior } : comoPergunta(t)
  })
}

export function temPerguntaAberta(fm: Fields, id: string): boolean {
  return perguntasDoCrivo(fm, id).some(q => !q.answer)
}

// Para o corpo do PR: pergunta respondida vira pergunta COM a resposta, e nao uma
// caixa vazia que o revisor humano teria de responder de novo.
export function linhasParaOPr(id: string, textos: readonly string[]): string[] {
  const respondidas = new Map(lerPerguntasDoCrivo(id).map(q => [q.q, q.answer ?? '']))
  return textos.map(t => {
    const r = respondidas.get(t)
    return r ? `- [x] ${t}\n      **respondido:** ${r}` : `- [ ] ${t}`
  })
}

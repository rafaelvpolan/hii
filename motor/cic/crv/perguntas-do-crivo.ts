// hicode:allow-any — `normalizarPergunta` recebe JSON que veio do MODELO, e o tipo
// dele e desconhecido por definicao: pode ser string (contrato antigo), objeto
// (novo), ou lixo. Declarar `unknown` na entrada e o que forca a checagem em
// execucao logo abaixo; tipar de outro jeito seria afirmar uma forma que ninguem
// garantiu. Este e o unico `unknown` do arquivo, e esta na fronteira.
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

// Opcoes de RESERVA. Quem propoe as respostas e a IA que fez a pergunta — ela sabe o
// que perguntou e quais respostas fazem sentido. Estas so entram quando a pergunta
// veio sem opcao: card gravado antes deste contrato, ou modelo que devolveu so o
// texto. Generico ("sim/nao/nao sei") responde qualquer pergunta e por isso nao ajuda
// em nenhuma; e melhor que campo vazio, e pior que a resposta que a IA propos.
const RESERVA = ['sim', 'nao', 'nao sei — investigue antes de seguir'] as const

export interface PerguntaDoCrivo {
  readonly q: string
  readonly opcoes: readonly string[]
}

function comoPergunta(p: PerguntaDoCrivo): ClarifyQuestion {
  const opcoes = p.opcoes.filter(Boolean)
  return { q: p.q, options: opcoes.length ? [...opcoes] : [...RESERVA], recommended: '' }
}

// Aceita as DUAS formas: texto solto (contrato antigo, e o que esta nos cards ja
// gravados) e objeto com opcoes (contrato novo). Card existente nao pode virar
// ilegivel porque o formato evoluiu.
export function normalizarPergunta(bruta: unknown): PerguntaDoCrivo | null {
  if (typeof bruta === 'string') {
    const q = bruta.trim()
    return q ? { q, opcoes: [] } : null
  }
  if (bruta && typeof bruta === 'object') {
    const o = bruta as { q?: unknown; opcoes?: unknown; options?: unknown }
    const q = String(o.q ?? '').trim()
    if (!q) return null
    const lista = Array.isArray(o.opcoes) ? o.opcoes : Array.isArray(o.options) ? o.options : []
    return { q, opcoes: lista.map(x => String(x).trim()).filter(Boolean).slice(0, 5) }
  }
  return null
}

// O card e a fonte da VERDADE sobre quais perguntas existem (o crivo as escreveu
// la); o arquivo guarda as RESPOSTAS. Ler dos dois e o que faz uma rodada nova do
// crivo, com perguntas diferentes, nao herdar resposta de pergunta que nao existe
// mais — e nao perder a resposta de pergunta que continua a mesma.
export function perguntasDoCrivo(fm: Fields, id: string): ClarifyQuestion[] {
  const bruto = String(fm.review_questions ?? '')
  if (!bruto) return []
  let brutas: PerguntaDoCrivo[]
  try {
    const parsed = JSON.parse(bruto) as PerguntaDoCrivo[]
    brutas = Array.isArray(parsed) ? parsed.map(normalizarPergunta).filter((x): x is PerguntaDoCrivo => x !== null) : []
  } catch {
    return []
  }
  if (!brutas.length) return []
  const respondidas = new Map(lerPerguntasDoCrivo(id).map(q => [q.q, q.answer ?? '']))
  return brutas.map(b => {
    const base = comoPergunta(b)
    const anterior = respondidas.get(b.q)
    return anterior ? { ...base, answer: anterior } : base
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

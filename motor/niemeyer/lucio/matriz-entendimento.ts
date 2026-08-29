import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { executarComIdempotencia } from '../../quilombo/salvo-conduto/idempotencia.ts'

// LUC — Lucio Costa: a estrutura vem antes de erguer parede.
//
// Pilar 1: nao se toca em codigo sem entender o que se vai fazer. O plano
// falava em "95% de entendimento", mas porcentagem que o proprio modelo
// atribui a si mesmo e autorrelato — o que nenhum gate deste motor aceita.
// Aqui vira arquivo em disco: ou as seis secoes estao respondidas, ou nao, e
// isso se le sem perguntar a ninguem.
//
// O que este modulo NAO faz, de proposito: julgar se a resposta esta certa.
// Nenhuma regra deterministica separa "zzz qqq" de uma resposta curta
// legitima sem julgar significado, e julgar significado exigiria um modelo
// dentro do gate. Quem julga e o humano na Fase 4 — a matriz so garante que
// exista o que ler. Ver PENDENCIAS.md, "LIMITE ACEITO".
//
// Tres rodadas de revisao adversarial furaram a guarda anti-vacuidade antes
// desta versao: lista finita de placeholders, comparacao por igualdade exata
// da linha, e fragmentacao de palavra com marca combinante invisivel. Por isso
// a regra e POSITIVA (UMA_PALAVRA_DE_VERDADE) em vez de enumerar lixo.

export const SECOES_DA_MATRIZ = [
  { id: 'requisito', titulo: 'Requisito confirmado', dica: 'o pedido original, linha a linha, no seu entendimento' },
  { id: 'entrada', titulo: 'Contrato de entrada', dica: 'o que entra: tipo, origem, o que ja vem validado' },
  { id: 'saida', titulo: 'Contrato de saida', dica: 'o que sai, e o que o chamador pode assumir' },
  { id: 'borda', titulo: 'Casos de borda', dica: 'vazio, ausente, duplicado, concorrente, grande demais' },
  { id: 'risco', titulo: 'Dependencia e risco', dica: 'de que isto depende e o que quebra se der errado' },
  { id: 'pronto', titulo: 'Definicao de pronto', dica: 'o sinal observavel de que acabou — comando, arquivo, estado' },
] as const

export type IdDeSecao = (typeof SECOES_DA_MATRIZ)[number]['id']

export const FASE_DA_MATRIZ = 'luc'
export const OPERACAO_DA_MATRIZ = 'matriz_criada'

function diretorioDeMatrizes(): string {
  return join(cardsDir(), 'matrizes')
}

export function arquivoDaMatriz(card: string): string {
  return join(diretorioDeMatrizes(), `matriz-entendimento-${card}.md`)
}

const AVISO_DO_TEMPLATE = [
  '> Responda as seis secoes ANTES de aprovar o plano. Dica em comentario nao',
  '> conta como resposta, e nem "TODO" ou "a definir": a conferencia le o que',
  '> esta escrito no arquivo, nao a intencao de quem escreveu.',
]

export function renderizarTemplate(card: string, titulo: string): string {
  const secoes = SECOES_DA_MATRIZ.map(s => `## ${s.titulo}\n\n<!-- ${s.dica} -->\n`)
  return [
    `# Matriz de entendimento — card ${card}`,
    '',
    `> Tarefa: ${titulo}`,
    '',
    ...AVISO_DO_TEMPLATE,
    '',
    secoes.join('\n'),
  ].join('\n')
}

export interface MatrizCriada {
  readonly caminho: string
  readonly reaproveitada: boolean
}

function arquivoJaExiste(caminho: string): boolean {
  try {
    return statSync(caminho).isFile()
  } catch {
    return false
  }
}

async function escreverSemSobrescreverResposta(caminho: string, conteudo: string): Promise<string> {
  mkdirSync(diretorioDeMatrizes(), { recursive: true })
  try {
    writeFileSync(caminho, conteudo, { flag: 'wx' })
  } catch (erro) {
    if (!arquivoJaExiste(caminho)) throw erro
  }
  return caminho
}

export async function criarMatriz(card: string, titulo: string): Promise<MatrizCriada> {
  const caminho = arquivoDaMatriz(card)
  const jaEstavaEmDisco = arquivoJaExiste(caminho)
  const efeito = await executarComIdempotencia({
    card,
    fase: FASE_DA_MATRIZ,
    operacao: OPERACAO_DA_MATRIZ,
    executar: () => escreverSemSobrescreverResposta(caminho, renderizarTemplate(card, titulo)),
  })
  return { caminho: efeito.resultado || caminho, reaproveitada: efeito.reaproveitada || jaEstavaEmDisco }
}

const PALAVRAS_QUE_ADIAM_A_RESPOSTA: ReadonlySet<string> = new Set([
  'todo', 'tbd', 'tba', 'wip', 'xxx', 'pendente', 'definir', 'preencher',
  'depois', 'ainda', 'talvez', 'nao', 'sei', 'sem', 'ideia', 'ver',
])

const UMA_PALAVRA_DE_VERDADE = /\p{L}{3,}/gu

function semAcentoNemMarca(texto: string): string {
  return texto.normalize('NFKD').replace(/\p{M}+/gu, '')
}

function semCaractereInvisivel(texto: string): string {
  return texto.replace(/[\p{C}\p{Zs}\p{Zl}\p{Zp}]+/gu, ' ')
}

function chaveDeComparacao(texto: string): string {
  return semAcentoNemMarca(semCaractereInvisivel(texto))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const TEXTOS_QUE_O_MOTOR_ESCREVEU: readonly string[] = [
  ...SECOES_DA_MATRIZ.map(s => chaveDeComparacao(s.dica)),
  ...SECOES_DA_MATRIZ.map(s => chaveDeComparacao(s.titulo)),
  ...AVISO_DO_TEMPLATE.map(l => chaveDeComparacao(l)),
].filter(t => t.length > 0).sort((a, b) => b.length - a.length)

function ehSoEcoDoMotor(chave: string): boolean {
  let resto = chave
  for (const texto of TEXTOS_QUE_O_MOTOR_ESCREVEU) resto = resto.split(texto).join(' ')
  return resto.trim() === ''
}

function ehDicaDoTemplate(linha: string): boolean {
  return semCaractereInvisivel(linha).trim().startsWith('<!--')
}

function palavrasDe(chave: string): string[] {
  return chave.match(UMA_PALAVRA_DE_VERDADE) ?? []
}

function ehLinhaDeResposta(linha: string): boolean {
  const chave = chaveDeComparacao(linha)
  if (!chave || ehDicaDoTemplate(linha) || ehSoEcoDoMotor(chave)) return false
  return palavrasDe(chave).some(p => !PALAVRAS_QUE_ADIAM_A_RESPOSTA.has(p))
}

function nivelDoCabecalho(linha: string): number {
  return (linha.trim().match(/^#{1,6}(?=\s)/)?.[0] ?? '').length
}

function ehFronteiraDeSecao(linha: string): boolean {
  const nivel = nivelDoCabecalho(linha)
  return nivel > 0 && nivel <= 2
}

function secaoDoCabecalho(linha: string): IdDeSecao | null {
  const titulo = chaveDeComparacao(linha.trim().replace(/^#{1,6}\s*/, ''))
  return SECOES_DA_MATRIZ.find(s => chaveDeComparacao(s.titulo) === titulo)?.id ?? null
}

function respostasPorSecao(texto: string): ReadonlyMap<IdDeSecao, string> {
  const linhasPorSecao = new Map<IdDeSecao, string[]>()
  let secaoAtual: IdDeSecao | null = null
  for (const linha of texto.split('\n')) {
    if (ehFronteiraDeSecao(linha)) {
      secaoAtual = secaoDoCabecalho(linha)
      continue
    }
    if (nivelDoCabecalho(linha) > 0) continue
    if (secaoAtual && ehLinhaDeResposta(linha)) {
      linhasPorSecao.set(secaoAtual, [...(linhasPorSecao.get(secaoAtual) ?? []), chaveDeComparacao(linha)])
    }
  }
  return new Map([...linhasPorSecao].map(([id, linhas]) => [id, linhas.join(' ')]))
}

function ehMesmoCarimboEmTodaSecao(respostas: ReadonlyMap<IdDeSecao, string>): boolean {
  if (respostas.size < SECOES_DA_MATRIZ.length) return false
  return new Set(respostas.values()).size === 1
}

export interface VeredictoDaMatriz {
  readonly existe: boolean
  readonly completa: boolean
  readonly faltando: readonly IdDeSecao[]
  readonly carimboRepetido: boolean
  readonly caminho: string
}

const TODAS_AS_SECOES: readonly IdDeSecao[] = SECOES_DA_MATRIZ.map(s => s.id)

export function conferirMatriz(card: string): VeredictoDaMatriz {
  const caminho = arquivoDaMatriz(card)
  if (!existsSync(caminho)) {
    return { existe: false, completa: false, faltando: TODAS_AS_SECOES, carimboRepetido: false, caminho }
  }
  const respostas = respostasPorSecao(readFileSync(caminho, 'utf8'))
  if (ehMesmoCarimboEmTodaSecao(respostas)) {
    return { existe: true, completa: false, faltando: TODAS_AS_SECOES, carimboRepetido: true, caminho }
  }
  const faltando = SECOES_DA_MATRIZ.filter(s => !respostas.has(s.id)).map(s => s.id)
  return { existe: true, completa: faltando.length === 0, faltando, carimboRepetido: false, caminho }
}

function tituloDe(id: IdDeSecao): string {
  return SECOES_DA_MATRIZ.find(s => s.id === id)?.titulo ?? id
}

export function relatoDaMatriz(v: VeredictoDaMatriz): string {
  if (!v.existe) return `matriz de entendimento ausente — responda ${v.caminho} antes de implementar`
  if (v.carimboRepetido) return `matriz de entendimento carimbada — as ${SECOES_DA_MATRIZ.length} secoes repetem o mesmo texto; cada uma pergunta outra coisa (${v.caminho})`
  if (v.completa) return `matriz de entendimento completa: ${SECOES_DA_MATRIZ.length} secoes respondidas`
  return `matriz de entendimento incompleta — falta responder: ${v.faltando.map(tituloDe).join(' · ')} (${v.caminho})`
}

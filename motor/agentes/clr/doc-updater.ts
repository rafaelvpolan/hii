// CLR — Clarice. Documentacao muda quando o CONTRATO PUBLICO muda, nao a cada commit.
//
// A distincao e o valor da peca: mexer no corpo de uma funcao nao muda nada para
// quem esta do lado de fora, e pedir atualizacao de doc ali gera ruido que faz o
// pedido ser ignorado quando importa. O que importa e o que alguem fora do
// arquivo consome — export, rota, esquema de config.
//
// Deterministico: le o diff, nao pergunta a modelo se "parece" mudanca de
// contrato. E aponta QUAIS docs, porque "atualize a documentacao" sem dizer onde
// e um pedido que ninguem cumpre.

export interface MudancaDeContrato {
  readonly mudou: boolean
  readonly motivos: readonly string[]
  readonly docsSugeridos: readonly string[]
}

export interface DiffParaContrato {
  readonly arquivos: readonly string[]
  readonly diff: string
}

const LINHA_DE_EXPORT = /^[+-]\s*export\b/m
const CAMINHO_DE_CONTRATO: readonly { rx: RegExp; motivo: string }[] = [
  { rx: /(?:^|\/)routes?\//i, motivo: 'rota alterada — contrato de URL e publico' },
  { rx: /(?:^|\/)api\//i, motivo: 'superficie de api alterada' },
  { rx: /Controller\.[a-z]+$|(?:^|\/)controllers?\//i, motivo: 'controller alterado — entrada publica' },
  { rx: /(?:^|\/)config\/[\w-]+\.json$/i, motivo: 'esquema de config alterado — quem le o arquivo esta fora do repo' },
  { rx: /(?:^|\/)package\.json$/i, motivo: 'manifesto do pacote alterado' },
]

const DOCS_PADRAO: readonly string[] = ['README.md']

export function contratoPublicoMudou(entrada: DiffParaContrato): MudancaDeContrato {
  const motivos: string[] = []
  if (LINHA_DE_EXPORT.test(entrada.diff)) motivos.push('export adicionado ou removido — assinatura publica mudou')
  for (const arquivo of entrada.arquivos) {
    for (const c of CAMINHO_DE_CONTRATO) {
      if (c.rx.test(arquivo)) motivos.push(`${arquivo}: ${c.motivo}`)
    }
  }
  const mudou = motivos.length > 0
  return { mudou, motivos, docsSugeridos: mudou ? DOCS_PADRAO : [] }
}

export function relatoDeContrato(v: MudancaDeContrato): string {
  if (!v.mudou) return 'contrato publico nao mexe — documentacao segue valida'
  return [
    `contrato publico mudou (${v.motivos.length} sinal(is)) — atualize: ${v.docsSugeridos.join(', ')}`,
    ...v.motivos.map(m => `- ${m}`),
  ].join('\n')
}

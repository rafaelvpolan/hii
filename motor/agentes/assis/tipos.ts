import { GATE_DIFF_LIMIT } from '../../cordel/alicerce/config.ts'

// Assis — os TIPOS e os LIMIARES da auditoria manual, separados de quem os aplica.
// Ficam num arquivo so porque limiar e contrato: mudar `MAX_LINHAS` aqui muda o
// que o auditor chama de monolito, e isso tem de ser uma linha visivel, nao um
// numero perdido no meio da funcao que o usa.

export const EXT_AUDITAVEL = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'py'])

const ORCAMENTO_FALLBACK = 60000

export function orcamentoValido(valor: number, fallback: number): number {
  const n = Math.floor(valor)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

export function tetoDeLotes(valor: number): number {
  const n = Math.floor(valor)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export const LOTE_CHARS_DEFAULT = orcamentoValido(
  Number(process.env.HICODE_AUDIT_LOTE_CHARS || GATE_DIFF_LIMIT),
  ORCAMENTO_FALLBACK,
)

export const DIR_GERADO = ['node_modules/', 'dist/', 'build/', 'coverage/', 'vendor/', '.nuxt/', '.output/', '.git/']
export const EXT_SEM_EXPORT = new Set(['py'])
// Espelha a ancora do hook (.claude/hooks/block-monolithic.mjs): a diretiva so vale
// em linha de COMENTARIO nas primeiras linhas. Sem isso, esta regex casava o proprio
// literal dela e a string da mensagem la embaixo — o arquivo se auto-sancionava como
// divida assumida que ninguem assumiu, e a ferramenta de auditoria mentia sobre si.
export const LINHAS_DO_TOPO = 10
export const RE_ALLOW_MONOLITO = /^\s*(?:\/\/|\/\*+|\*|#|<!--)\s*hicode:allow-monolith\b/
export const MAX_LINHAS = 350
export const GOD_FUNCS = 20
export const GOD_EXPORTS = 3
export const PESO_MONOLITO = 60
export const PESO_GOD_FILE = 50
export const PESO_SEM_TESTE = 25
export const PESO_POR_LINHA = 0.1
export const FATOR_TESTE = 0.6

export type MotivoFora =
  | 'extensao-nao-auditavel'
  | 'diretorio-gerado'
  | 'arquivo-vazio'
  | 'ilegivel'
  | 'maior-que-o-lote'
  | 'acima-do-limite-de-lotes'

export type Gravidade = 'alta' | 'media' | 'baixa'

export interface ForaDaAuditoria {
  path: string
  motivo: MotivoFora
  detalhe: string
}

export interface ArquivoAuditavel {
  path: string
  chars: number
  linhas: number
  funcoes: number
  exports: number
  excedeLinhas: boolean
  godFile: boolean
  semTeste: boolean
  risco: number
  motivos: string[]
}

export interface LoteAuditoria {
  indice: number
  arquivos: ArquivoAuditavel[]
  chars: number
}

export interface PlanoAuditoria {
  lotes: LoteAuditoria[]
  fora: ForaDaAuditoria[]
  totalListado: number
  totalAuditado: number
  orcamentoChars: number
  escopo: string
}

export interface OpcoesAuditoria {
  raiz?: string
  listar?: () => Promise<string[]>
  ler?: (path: string) => string | null
  orcamentoChars?: number
  maxLotes?: number
  escopo?: string
  // Recorte por LISTA EXATA de caminhos, para auditar a superficie de uma branch
  // (os arquivos que o diff tocou) em vez de um prefixo de diretorio. Vazio ou
  // ausente = sem recorte por lista.
  //
  // Separado de `escopo` de proposito: `escopo` e prefixo cru e serve para
  // recortar um diretorio; um diff espalha por dezenas de diretorios e nao tem
  // prefixo comum. A cobertura de teste continua sendo calculada sobre o repo
  // INTEIRO nos dois casos — um recorte nao pode fazer o auditor esquecer que o
  // teste existe.
  apenas?: readonly string[]
}

export interface AchadoAuditoria {
  path: string
  gravidade: Gravidade
  resumo: string
  lote: number
  linha?: number
}

export interface GrupoFora {
  motivo: MotivoFora
  label: string
  quantidade: number
  paths: string[]
}

export const LABEL_FORA: Record<MotivoFora, string> = {
  'extensao-nao-auditavel': 'nao e codigo auditavel (config/IaC/docs/binario)',
  'diretorio-gerado': 'diretorio gerado ou vendor',
  'arquivo-vazio': 'arquivo sem conteudo util',
  'ilegivel': 'nao foi possivel ler como texto',
  'maior-que-o-lote': 'arquivo maior que o orcamento de um lote',
  'acima-do-limite-de-lotes': 'cortado pelo limite de lotes desta execucao',
}

export const RANK_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 }

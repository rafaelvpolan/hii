import { ROOT } from '../../cdl/ali/config.ts'
import { runGit } from '../../qlb/git.ts'
import { LOTE_CHARS_DEFAULT, orcamentoValido, tetoDeLotes } from './tipos.ts'
import type { ArquivoAuditavel, ForaDaAuditoria, LoteAuditoria, OpcoesAuditoria, PlanoAuditoria } from './tipos.ts'
import { coberturaDeTeste } from './cobertura.ts'
import { lerTexto, metricasDe, rejeitarPorCaminho } from './metricas.ts'

// ASS — a SELECAO: o que entra na auditoria, em que ordem, e em quantos lotes.
// O que fica de fora sai NOMEADO com motivo, porque cobertura declarada sem a
// lista do que ficou de fora e a mesma impressao de completude que a auditoria
// existe para desmontar.

export async function listarRastreados(raiz: string): Promise<string[]> {
  const r = await runGit(raiz, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  if (r.err) throw new Error(`git ls-files falhou em ${raiz}: ${r.stderr.trim() || r.err.message}`)
  return r.stdout.split('\0').filter(s => s.length > 0)
}

export function ordenarPorRisco(arquivos: ArquivoAuditavel[]): ArquivoAuditavel[] {
  return [...arquivos].sort((a, b) => (b.risco - a.risco) || (b.chars - a.chars) || a.path.localeCompare(b.path))
}

function montarLotes(arquivos: ArquivoAuditavel[], orcamento: number): LoteAuditoria[] {
  const lotes: LoteAuditoria[] = []
  let atual: LoteAuditoria | null = null
  for (const a of arquivos) {
    if (!atual || atual.chars + a.chars > orcamento) {
      atual = { indice: lotes.length + 1, arquivos: [], chars: 0 }
      lotes.push(atual)
    }
    atual.arquivos.push(a)
    atual.chars += a.chars
  }
  return lotes
}

function unicos(paths: string[]): string[] {
  return [...new Set(paths.filter(p => p.length > 0))]
}

export async function selecionarAuditoria(opts: OpcoesAuditoria = {}): Promise<PlanoAuditoria> {
  const raiz = opts.raiz ?? ROOT
  const orcamentoChars = orcamentoValido(opts.orcamentoChars ?? LOTE_CHARS_DEFAULT, LOTE_CHARS_DEFAULT)
  const maxLotes = tetoDeLotes(opts.maxLotes ?? 0)
  const listar = opts.listar ?? (() => listarRastreados(raiz))
  const ler = opts.ler ?? ((p: string) => lerTexto(raiz, p))
  const escopo = (opts.escopo ?? '').trim()
  const listados = unicos(await listar())
  // Le o repo INTEIRO para montar a cobertura, nao so o escopo pedido: um
  // recorte de escopo nao pode fazer o auditor esquecer que o teste existe.
  const cobertura = coberturaDeTeste(listados, ler)
  const lista = new Set(opts.apenas ?? [])
  const comEscopo = escopo ? listados.filter(p => p.startsWith(escopo)) : listados
  const paths = lista.size ? comEscopo.filter(p => lista.has(p)) : comEscopo
  const fora: ForaDaAuditoria[] = []
  const auditaveis: ArquivoAuditavel[] = []
  for (const path of paths) {
    const rejeicao = rejeitarPorCaminho(path)
    if (rejeicao) { fora.push({ path, ...rejeicao }); continue }
    const texto = ler(path)
    if (texto === null) { fora.push({ path, motivo: 'ilegivel', detalhe: 'leitura falhou' }); continue }
    if (texto.includes('\0')) { fora.push({ path, motivo: 'ilegivel', detalhe: 'conteudo binario' }); continue }
    if (!texto.trim()) { fora.push({ path, motivo: 'arquivo-vazio', detalhe: '0 caractere util' }); continue }
    if (texto.length > orcamentoChars) {
      fora.push({ path, motivo: 'maior-que-o-lote', detalhe: `${texto.length} chars > orcamento de ${orcamentoChars} por lote` })
      continue
    }
    auditaveis.push(metricasDe(path, texto, cobertura))
  }
  const lotes = montarLotes(ordenarPorRisco(auditaveis), orcamentoChars)
  const cortados = maxLotes > 0 ? lotes.splice(maxLotes) : []
  for (const lote of cortados) {
    for (const a of lote.arquivos) {
      fora.push({ path: a.path, motivo: 'acima-do-limite-de-lotes', detalhe: `passou do limite de ${maxLotes} lote(s) por execucao` })
    }
  }
  const totalAuditado = lotes.reduce((n, l) => n + l.arquivos.length, 0)
  return { lotes, fora, totalListado: paths.length, totalAuditado, orcamentoChars, escopo }
}

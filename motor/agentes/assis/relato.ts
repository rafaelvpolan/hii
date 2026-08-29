import { LABEL_FORA, RANK_GRAVIDADE } from './tipos.ts'
import type { AchadoAuditoria, GrupoFora, LoteAuditoria, MotivoFora, PlanoAuditoria } from './tipos.ts'

// Assis — o RELATO. Tudo aqui e leitura de um plano ja montado: nenhuma funcao
// deste arquivo decide o que auditar, so como contar o que foi decidido.

export function coberturaFecha(plano: PlanoAuditoria): boolean {
  return plano.totalAuditado + plano.fora.length === plano.totalListado
}

export function foraPorMotivo(plano: PlanoAuditoria): GrupoFora[] {
  const mapa = new Map<MotivoFora, string[]>()
  for (const f of plano.fora) {
    const atual = mapa.get(f.motivo)
    if (atual) atual.push(f.path)
    else mapa.set(f.motivo, [f.path])
  }
  return [...mapa.entries()]
    .map(([motivo, paths]) => ({ motivo, label: LABEL_FORA[motivo], quantidade: paths.length, paths }))
    .sort((a, b) => (b.quantidade - a.quantidade) || a.motivo.localeCompare(b.motivo))
}

export function resumoAuditoria(plano: PlanoAuditoria): string {
  const linhas = [
    `auditoria manual: ${plano.totalAuditado} de ${plano.totalListado} arquivo(s) em ${plano.lotes.length} lote(s) — orcamento ${plano.orcamentoChars} chars/lote`,
  ]
  if (plano.escopo) {
    linhas.push(`escopo: ${plano.escopo} — recorte pedido; a cobertura declarada vale somente para ele, nao para o repo inteiro`)
    if (!plano.totalListado) {
      linhas.push(`ATENCAO: o recorte ${plano.escopo} nao casou com nenhum arquivo listado — confira o prefixo; nada foi auditado`)
    }
  }
  for (const g of foraPorMotivo(plano)) {
    const amostra = g.paths.slice(0, 5).join(', ')
    const resto = g.paths.length > 5 ? `, +${g.paths.length - 5}` : ''
    linhas.push(`fora (${g.quantidade}): ${g.label} — ${amostra}${resto}`)
  }
  if (!plano.fora.length) linhas.push('fora (0): nenhum arquivo ficou fora')
  if (!coberturaFecha(plano)) {
    linhas.push(`ATENCAO: contagem nao fecha (${plano.totalAuditado} + ${plano.fora.length} != ${plano.totalListado}) — nao declare cobertura`)
  }
  return linhas.join('\n')
}

export function renderLote(lote: LoteAuditoria, totalLotes: number): string {
  const cabecalho = `LOTE ${lote.indice}/${totalLotes} — ${lote.arquivos.length} arquivo(s), ${lote.chars} chars`
  const itens = lote.arquivos.map(a => {
    const risco = a.motivos.length ? ` — ${a.motivos.join('; ')}` : ''
    return `- ${a.path} (${a.linhas} linhas, ${a.funcoes} funcoes, ${a.exports} exports, risco ${a.risco})${risco}`
  })
  return [cabecalho, ...itens].join('\n')
}

export function ordenarAchados(achados: AchadoAuditoria[]): AchadoAuditoria[] {
  return [...achados].sort((a, b) =>
    (RANK_GRAVIDADE[a.gravidade] - RANK_GRAVIDADE[b.gravidade]) ||
    a.path.localeCompare(b.path) ||
    ((a.linha ?? 0) - (b.linha ?? 0)))
}

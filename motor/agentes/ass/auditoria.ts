// ASS — a face publica da auditoria manual (`/verificar`).
//
// O arquivo era um monolito de 402 linhas que misturava quatro assuntos: os
// limiares, a medicao de um arquivo, a decisao de quem tem teste, a montagem
// dos lotes e o relato. A auditoria que ele executa reprova arquivo com esse
// formato — uma ferramenta que se isenta do proprio criterio nao vale como
// criterio. Aqui ficou so o reexport, para nenhum chamador ter de mudar.

export { EXT_AUDITAVEL, LOTE_CHARS_DEFAULT } from './tipos.ts'
export type {
  AchadoAuditoria, ArquivoAuditavel, ForaDaAuditoria, Gravidade, GrupoFora,
  LoteAuditoria, MotivoFora, OpcoesAuditoria, PlanoAuditoria,
} from './tipos.ts'
export { ehArquivoDeTeste, stemsDeTeste, coberturaDeTeste, temTesteCorrespondente } from './cobertura.ts'
export type { CoberturaDeTeste } from './cobertura.ts'
export { listarRastreados, ordenarPorRisco, selecionarAuditoria } from './plano.ts'
export { coberturaFecha, foraPorMotivo, ordenarAchados, renderLote, resumoAuditoria } from './relato.ts'

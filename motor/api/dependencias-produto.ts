import { analisarTecnico } from '../oswaldo/orquestracao/tecnico.ts'
import type { DependenciaDeProduto } from '../oswaldo/orquestracao/contrato.ts'
import { readCard } from '../cordel/store.ts'
import { etagDe } from '../cordel/revisao.ts'
import { avaliarExecucao } from './avaliacao.ts'
import { objeto, campos, texto, ErroApi } from './contrato.ts'
import type { Objeto } from './contrato.ts'
export interface PreparoDeDependencias { provas: DependenciaDeProduto[]; conferir: () => void }
export async function prepararDependencias(repo: string, b: Objeto): Promise<PreparoDeDependencias> {
  const vazio = { provas: [], conferir: () => {} }
  if (typeof b.tecnico !== 'string') {
    if (b.dependencias !== undefined) throw new ErroApi(400, 'dependencias_invalidas', 'dependencias exigem documento tecnico')
    return vazio
  }
  const { documento: d, erros } = analisarTecnico(b.tecnico)
  if (!d || erros.length) return vazio // o despacho relata os erros canonicos
  if (d.repo !== repo) throw new ErroApi(403, 'escopo_invalido', 'documento pertence a outro projeto')
  const refs = b.dependencias ?? []
  if (!Array.isArray(refs) || refs.length !== d.dependencias.length || refs.length > 8) throw new ErroApi(409, 'dependencias_pendentes', 'envie um vinculo por dependencia de produto (maximo 8)')
  const ids = new Set<string>()
  const vistos: { id: string; etag: string }[] = []
  const provas = await Promise.all(refs.map(async ref => {
    const r = objeto(ref); campos(r, ['produto', 'execucao', 'tecnicoHash'])
    const produto = texto(r, 'produto'), execucao = texto(r, 'execucao'), tecnicoHash = texto(r, 'tecnicoHash')
    if (!d.dependencias.includes(produto) || produto === d.produtoId || ids.has(produto) || !/^\d{3,12}$/.test(execucao) || !/^[a-f0-9]{64}$/.test(tecnicoHash)) throw new ErroApi(409, 'dependencias_invalidas', 'dependencia ausente, duplicada ou vinculo invalido: ' + produto)
    ids.add(produto)
    const antes = readCard(execucao)
    if (!antes || antes.fm.repo !== repo) throw new ErroApi(409, 'dependencia_invalida', 'execucao da dependencia indisponivel neste projeto: ' + produto)
    const etag = etagDe(antes)
    const a = await avaliarExecucao(execucao)
    const depois = readCard(execucao)
    if (!depois || etagDe(depois) !== etag || !['MERGED', 'DEPLOYED'].includes(a.status) || a.modo !== 'passivo' ||
      a.atualidade !== 'atual' || !a.criteriosAprovados || !a.entrega?.merge || a.plano?.produto !== produto ||
      a.plano.planejamento !== d.origem.planejamento || a.plano.origemRevisao !== d.origem.revisao || a.plano.tecnicoHash !== tecnicoHash) {
      throw new ErroApi(409, 'dependencia_nao_comprovada', 'dependencia sem entrega atual da revisao aprovada: ' + produto)
    }
    vistos.push({ id: execucao, etag })
    return { produto, execucao, tecnicoHash, merge: a.entrega.merge, certificado: antes.fm.entrega_evidencia || '' }
  }))
  const conferir = (): void => {
    for (const v of vistos) {
      const c = readCard(v.id)
      if (!c || etagDe(c) !== v.etag) throw new ErroApi(409, 'dependencia_alterada', 'dependencia mudou durante o despacho: ' + v.id)
    }
  }
  conferir()
  return { provas, conferir }
}

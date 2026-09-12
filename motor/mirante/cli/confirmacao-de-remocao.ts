import { planejarLote } from '../../cordel/remover.ts'
import { renderRemocao } from '../render/remocao.ts'

export interface OpcoesDaConfirmacao {
  color: boolean
  width: number
}

// O plano do /rm ia para o log rolante e so a dica "enter confirma" ficava no
// rodape: com a tela cheia, a pessoa confirmava sem ver O QUE ia apagar. O bloco
// agora e renderizado ACIMA do prompt enquanto `removendo` estiver armado, com
// os mesmos alvos que o despacho escolheu (ja filtrados por --force).
export function confirmacaoDeRemocao(removendo: string, o: OpcoesDaConfirmacao): string[] {
  const ids = removendo.split(/\s+/).filter(Boolean)
  if (!ids.length) return []
  return renderRemocao(planejarLote(ids), true, { color: o.color, width: o.width, confirmacao: true }).filter((l, i, arr) => !(i === 0 && l === '') && !(i === arr.length - 1 && l === ''))
}

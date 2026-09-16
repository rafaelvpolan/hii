import { lerPlano, salvarPlano } from '../oswaldo/orquestracao/planos.ts'
import { validarPlano } from '../oswaldo/orquestracao/contrato.ts'
import type { PlanoDeExecucao } from '../oswaldo/orquestracao/contrato.ts'
import { tarefa } from './operacoes.ts'
import { patchCard } from '../cordel/store.ts'
import { comRevisao, RevisaoAlterada } from '../cordel/revisao.ts'
import { motivoParaEsperarHarness } from '../tomada/harness-em-voo.ts'
import { campos, objeto, ErroApi } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'

export function revisarPlano(id: string, b: Objeto, esperado: string, chave: string): RespostaApi {
  campos(b, ['plano', 'revisaoEsperada'])
  const t = tarefa(id)
  if (!esperado) throw new ErroApi(428, 'revisao_obrigatoria', 'envie If-Match da tarefa')
  if (esperado !== t.etag) throw new ErroApi(412, 'revisao_alterada', 'tarefa mudou')
  if (!['INBOX', 'HALTED', 'PAUSED'].includes(t.campos.status ?? '') || motivoParaEsperarHarness(id)) throw new ErroApi(409, 'plano_em_uso', 'pause a tarefa e aguarde a chamada terminar')
  const plano = objeto(b.plano ?? null) as object as PlanoDeExecucao
  try { validarPlano(plano) } catch { throw new ErroApi(400, 'plano_invalido', 'plano v1 invalido') }
  if (plano.id !== id || plano.repo !== t.campos.repo || plano.sessaoId !== (t.campos.sessao_id || id)) throw new ErroApi(400, 'escopo_invalido', 'plano pertence a outro escopo')
  const anterior = lerPlano(plano.repo, id)
  if (b.revisaoEsperada !== (anterior?.revisao ?? 0)) throw new ErroApi(412, 'revisao_alterada', 'plano mudou')
  // Um editor de plano nao vira terminal remoto. Comandos sao os ja aprovados
  // pelo contrato local; cliente altera DAG, instrucoes e criterios escritos.
  for (const c of plano.criterios) if (c.comando && !anterior?.plano.criterios.some(a => JSON.stringify(a.comando) === JSON.stringify(c.comando))) throw new ErroApi(400, 'comando_recusado', 'comandos novos exigem contrato local do projeto')
  try {
    const r = salvarPlano(plano, anterior?.revisao ?? 0, chave)
    comRevisao(id, esperado, () => patchCard(id, { plano_revisao: String(r.revisao), plano_hash: r.hash }, 'plano revisado pela API; requer retomada explicita'))
    return resposta(200, { plano: r, tarefa: tarefa(id) }, tarefa(id).etag)
  } catch (e) {
    if (e instanceof RevisaoAlterada) throw new ErroApi(412, 'revisao_alterada', 'tarefa mudou; revisao salva mas nao ativada')
    throw e
  }
}

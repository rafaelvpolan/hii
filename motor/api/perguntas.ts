import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { pendencia } from '../mirante/responder.ts'
import { etagDe } from '../cordel/revisao.ts'
import { withFileLock } from '../oswaldo/mutirao/trava-arquivo.ts'
import { tarefa, agir } from './operacoes.ts'
import { campos, texto, ErroApi } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import { hash, resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'

export function perguntas(id: string): RespostaApi {
  const t = tarefa(id)
  const p = pendencia(id)
  const perguntaId = p ? hash(JSON.stringify([id, p.origem, p.indice, p.atual.q])).slice(0, 32) : null
  return resposta(200, { perguntaId, pendencia: p }, etagDe({ tarefa: t.etag, pendencia: p }))
}
export function responderPergunta(id: string, b: Objeto, esperado: string): RespostaApi {
  campos(b, ['perguntaId', 'texto'])
  const perguntaId = texto(b, 'perguntaId')
  const entrada = texto(b, 'texto')
  if (!esperado) throw new ErroApi(428, 'revisao_obrigatoria', 'envie If-Match do GET perguntas')
  const dir = join(cardsDir(), 'ponte', 'respostas')
  mkdirSync(dir, { recursive: true })
  return withFileLock(join(dir, id), () => {
    const atual = perguntas(id)
    const p = JSON.parse(atual.corpo) as { perguntaId: string | null }
    if (atual.etag !== esperado || p.perguntaId !== perguntaId) throw new ErroApi(412, 'pergunta_alterada', 'pergunta mudou; consulte novamente antes de responder')
    return agir(id, { acao: 'responder', texto: entrada }, tarefa(id).etag)
  })
}

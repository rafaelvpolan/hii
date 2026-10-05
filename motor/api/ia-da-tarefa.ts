import { existsSync, readFileSync } from 'node:fs'
import { readCard } from '../cordel/store.ts'
import { harnessSeExistir } from '../tomada/registro.ts'
import { comRevisao, RevisaoAlterada } from '../cordel/revisao.ts'
import { arquivoDoPacote, definirIaDoCard, iasDoCard, PAPEIS_COM_IA } from '../niemeyer/lucio/aprovacao-do-pacote.ts'
import { campos, ErroApi, texto } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'
import { tarefa } from './operacoes.ts'

export function iaDaTarefa(id: string): RespostaApi {
  const t = tarefa(id)
  return resposta(200, { id, papeis: PAPEIS_COM_IA, ias: iasDoCard(t.campos), observacao: 'provedor vazio = padrao do motor (/v1/configuracao)' }, t.etag)
}

export function pacoteDaTarefa(id: string): RespostaApi {
  const t = tarefa(id)
  const arquivo = arquivoDoPacote(id)
  const markdown = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : ''
  return resposta(200, { id, hash: t.campos.pacote_hash || null, status: t.campos.pacote_status || null, aprovadoHash: t.campos.pacote_aprovado_hash || null, resumo: t.campos.pacote_resumo || null, markdown }, t.etag)
}

function validarCapacidade(papel: string, provedor: string): void {
  if (!provedor) return
  const h = harnessSeExistir(provedor)
  if (!h) throw new ErroApi(400, 'provedor_invalido', 'provedor nao registrado')
  const caps = h.capabilities()
  if (papel === 'implement' && !h.agentic) throw new ErroApi(400, 'capacidade_insuficiente', 'provedor nao executa edicao de arquivos')
  if ((papel === 'gate' || papel === 'verify') && (!caps.isolatesReadonly || !caps.emitsStructuredJson)) throw new ErroApi(400, 'capacidade_insuficiente', 'verificacao exige leitura isolada e JSON estruturado')
}

export function definirIaDaTarefa(id: string, b: Objeto, esperado: string): RespostaApi {
  campos(b, ['papel', 'provedor', 'modelo'])
  if (!esperado) throw new ErroApi(428, 'revisao_obrigatoria', 'envie If-Match do GET /ia')
  const papel = texto(b, 'papel')
  const provedor = b.provedor === '' ? '' : texto(b, 'provedor', true, 64)
  const modelo = b.modelo === undefined || b.modelo === '' ? undefined : texto(b, 'modelo', false, 200)
  validarCapacidade(papel, provedor)
  if (!readCard(id)) throw new ErroApi(404, 'tarefa_ausente', 'tarefa nao encontrada')
  try {
    const r = comRevisao(id, esperado, () => definirIaDoCard(id, { papel, provedor, modelo }))
    if (!r.ok) throw new ErroApi(409, 'ia_recusada', r.reason)
  } catch (erro) {
    if (erro instanceof RevisaoAlterada) throw new ErroApi(412, 'revisao_alterada', 'tarefa mudou; consulte novamente')
    throw erro
  }
  return iaDaTarefa(id)
}

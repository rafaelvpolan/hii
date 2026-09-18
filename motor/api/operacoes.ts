import { estadoMotor } from './estado-motor.ts'
import type { DependenciaDeProduto } from '../oswaldo/orquestracao/contrato.ts'
import { despacharTecnico } from './tecnico.ts'
import { readCard, repoRegistered, listRepos, patchCard } from '../cordel/store.ts'
import { criarExecucao } from '../mirante/criar-execucao.ts'
import * as acoes from '../mirante/acoes.ts'
import { executarAcao } from '../mirante/comandos-de-tarefa.ts'
import { fecharSessaoHii, lerSessaoHii } from '../euclides/sessoes.ts'
import { pedirSuiteManual } from '../quilombo/cartorio/passos-manuais.ts'
import { motivoParaEsperarHarness } from '../tomada/harness-em-voo.ts'
import { ErroApi, objeto, campos, texto, acaoValida } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'
import { etagDe, comRevisao, RevisaoAlterada } from '../cordel/revisao.ts'

export function tarefa(id: string): { etag: string; campos: Record<string, string>; objetivo: string } {
  const c = readCard(id)
  if (!c) throw new ErroApi(404, 'tarefa_ausente', 'tarefa nao encontrada')
  return { etag: etagDe(c), campos: c.fm, objetivo: c.body }
}

function comparar(etag: string, esperado: string): void {
  if (!esperado) throw new ErroApi(428, 'revisao_obrigatoria', 'envie If-Match obtido no GET do recurso')
  if (esperado !== etag) throw new ErroApi(412, 'revisao_alterada', 'recurso mudou; consulte novamente')
}

export function sessao(id: string): NonNullable<ReturnType<typeof lerSessaoHii>> {
  const s = lerSessaoHii(id)
  if (!s) throw new ErroApi(404, 'sessao_ausente', 'session nao encontrada')
  return s
}
export function etagDaSessao(id: string): string { return etagDe(sessao(id)) }

export function novaSessao(b: Objeto): RespostaApi {
  campos(b, ['repo', 'titulo'])
  const repo = texto(b, 'repo', true, 256)
  const titulo = texto(b, 'titulo', true, 500)
  if (!repoRegistered(repo)) throw new ErroApi(404, 'repo_ausente', 'projeto nao registrado no HII')
  const id = acoes.submitSession({ title: titulo, repo })
  return resposta(201, sessao(id), etagDaSessao(id))
}

function pedido(b: Objeto): { titulo: string; descricao: string } {
  if (b.spec !== undefined) {
    if (b.texto !== undefined) throw new ErroApi(400, 'entrada_invalida', 'envie texto ou spec, nao ambos')
    const spec = objeto(b.spec)
    campos(spec, ['nome', 'conteudo'])
    const nome = texto(spec, 'nome', true, 200)
    if (!/^[^/\\]+\.spec(?:\.md)?$/.test(nome)) throw new ErroApi(400, 'spec_invalido', 'nome deve terminar em .spec ou .spec.md, sem caminho')
    const conteudo = texto(spec, 'conteudo')
    return { titulo: nome, descricao: `Especificacao: ${nome}\n\n${conteudo.replace(/^##(?=\s|$)/gm, '> ##')}` }
  }
  const t = texto(b, 'texto')
  return { titulo: t, descricao: t.replace(/^##(?=\s|$)/gm, '> ##') }
}

export function novoPedido(id: string, b: Objeto, dependencias: DependenciaDeProduto[] = []): RespostaApi {
  campos(b, ['modo', 'texto', 'spec', 'tecnico', 'dependencias'])
  const s = sessao(id)
  if (s.estado !== 'aberta') throw new ErroApi(409, 'sessao_fechada', 'abra outra session')
  if (!repoRegistered(s.repo)) throw new ErroApi(409, 'repo_ausente', 'projeto nao esta mais registrado')
  const modo = texto(b, 'modo')
  if (!['gateway', 'orquestrador'].includes(modo)) throw new ErroApi(400, 'modo_invalido', 'modo: gateway ou orquestrador')
  if (modo === 'gateway' && b.spec !== undefined) throw new ErroApi(400, 'modo_invalido', 'spec exige modo orquestrador')
  if (b.tecnico !== undefined) {
    if (modo !== 'orquestrador' || b.texto !== undefined || b.spec !== undefined || typeof b.tecnico !== 'string') throw new ErroApi(400, 'entrada_invalida', 'tecnico exige orquestrador e documento exclusivo')
    return despacharTecnico(id, s.repo, b.tecnico, dependencias)
  }
  const p = pedido(b)
  const execucao = criarExecucao(s.repo, id, p.titulo, modo === 'orquestrador' ? 'passivo' : 'gateway', { desc: p.descricao })
  const aprovado = acoes.approvePlan(execucao.id)
  return resposta(201, { id: execucao.id, sessao: id, modo, status: readCard(execucao.id)?.fm.status, enfileirada: aprovado.ok, mensagem: aprovado.reason })
}

export function fecharSessao(id: string, esperado: string, b: Objeto): RespostaApi {
  campos(b, [])
  comparar(etagDaSessao(id), esperado)
  try { return resposta(200, comRevisao(id, esperado, () => fecharSessaoHii(id))) } catch (erro) {
    if (erro instanceof RevisaoAlterada) throw new ErroApi(412, 'revisao_alterada', 'session mudou; consulte novamente')
    throw new ErroApi(409, 'sessao_ocupada', 'conclua ou pare as execucoes antes de fechar')
  }
}

export function agir(id: string, b: Objeto, esperado: string): RespostaApi {
  try { return comRevisao(id, esperado, () => agirNaRevisao(id, b, esperado)) } catch (erro) {
    if (erro instanceof RevisaoAlterada) throw new ErroApi(412, 'revisao_alterada', 'tarefa mudou; consulte novamente')
    throw erro
  }
}

function agirNaRevisao(id: string, b: Objeto, esperado: string): RespostaApi {
  campos(b, ['acao', 'texto'])
  const t = tarefa(id)
  comparar(t.etag, esperado)
  if (t.campos.tipo === 'session') throw new ErroApi(409, 'alvo_invalido', 'session nao e tarefa executavel')
  const acao = texto(b, 'acao')
  const argumento = texto(b, 'texto', false)
  if (!acaoValida(acao)) throw new ErroApi(400, 'acao_invalida', 'acao nao suportada')
  if (acao === 'iniciar') {
    if (t.campos.status !== 'READY') throw new ErroApi(409, 'estado_invalido', 'inicio exige tarefa READY; parada humana exige retomada explicita')
    const motor = estadoMotor()
    if (motor.estado !== 'ligado') throw new ErroApi(503, 'motor_indisponivel', motor.motivo)
    const r = acoes.transition(id, 'EXECUTING', 'inicio recebido pela API do motor')
    if (!r) throw new ErroApi(409, 'inicio_recusado', 'motor recusou o inicio')
    return resposta(200, { ok: true, id, status: 'EXECUTING' })
  }
  if (acao === 'retomar') {
    if (!['HALTED', 'PAUSED'].includes(t.campos.status ?? '')) throw new ErroApi(409, 'estado_invalido', 'tarefa nao esta parada')
    if (motivoParaEsperarHarness(id)) throw new ErroApi(409, 'harness_em_voo', 'aguarde o encerramento do harness')
    if (t.campos.pipeline_pausa === 'manual') {
      const r = pedirSuiteManual(id)
      return resposta(r.ok ? 200 : 409, r)
    }
    const alvo = t.campos.retomar_em || 'EXECUTING'
    if (!['EXECUTING', 'URL_OK', 'CORRECTING'].includes(alvo)) throw new ErroApi(409, 'retomada_invalida', 'checkpoint exige intervencao local')
    const r = acoes.transition(id, alvo, 'retomado pela API')
    if (!r) throw new ErroApi(409, 'retomada_recusada', 'retomada recusada pelo motor')
    patchCard(id, { retomar_em: '' })
    return resposta(200, { ok: true, id, status: alvo })
  }
  if (acao === 'confirmar-fecho' || acao === 'recusar-fecho') {
    const r = acao === 'confirmar-fecho' ? acoes.confirmarFecho(id) : acoes.recusarFecho(id, argumento)
    return resposta(r.ok ? 200 : 409, r)
  }
  if (acao === 'parar' && ['COMPLETED', 'PR_OPEN', 'MERGED', 'DEPLOYED'].includes(t.campos.status ?? '')) {
    throw new ErroApi(409, 'estado_invalido', 'tarefa ja encerrada')
  }
  const r = executarAcao(acao, id, argumento)
  return resposta(r.ok ? 200 : 409, r)
}

export function projetos(): { nome: string }[] { return listRepos().map(r => ({ nome: r.name })) }

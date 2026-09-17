import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import { analisarTecnico } from '../oswaldo/orquestracao/tecnico.ts'
import { salvarPlano } from '../oswaldo/orquestracao/planos.ts'
import { validarPlano } from '../oswaldo/orquestracao/contrato.ts'
import type { PlanoDeExecucao } from '../oswaldo/orquestracao/contrato.ts'
import { readContract } from '../cordel/bussola/armazenar.ts'
import { resolveCommand } from '../mirante/comandos.ts'
import { repoPath, patchCard, readCard } from '../cordel/store.ts'
import { submit, approvePlan } from '../mirante/acoes.ts'
import { registrarPedido } from '../mirante/execucao-da-sessao.ts'
import { AGENTES_IMPLEMENT } from '../ciclo/agente.ts'
import { harnessPorNome } from '../tomada/registro.ts'
import { ErroApi } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'

export function despacharTecnico(sessao: string, repo: string, fonte: string): RespostaApi {
  if (Buffer.byteLength(fonte) > 200000) throw new ErroApi(400, 'tecnico_invalido', 'limite de 200000 bytes UTF-8')
  const { documento: d, erros } = analisarTecnico(fonte)
  if (!d || erros.length) throw new ErroApi(400, 'tecnico_invalido', erros.map(e => `${e.campo}: ${e.mensagem}`).join('; '))
  if (d.repo !== repo) throw new ErroApi(403, 'escopo_invalido', 'documento pertence a outro projeto')
  // Dependencias externas nao sao apenas texto: sem vinculo verificavel nao despacha.
  if (d.dependencias.length) throw new ErroApi(409, 'dependencias_pendentes', 'reconcilie as dependencias de produto antes de despachar este documento')
  for (const m of d.microtasks) {
    if (!AGENTES_IMPLEMENT.includes(m.agente)) throw new ErroApi(400, 'agente_invalido', 'microtasks.' + m.id + '.agente: agente de implementacao indisponivel')
    try { if (m.ia && !harnessPorNome(m.ia.provedor).agentic) throw new Error('nao edita arquivos') }
    catch { throw new ErroApi(400, 'provedor_invalido', `microtasks.${m.id}.ia: provedor incapaz ou desconhecido`) }
  }
  const raiz = repoPath(repo)
  const contrato = readContract(raiz)
  const criterios = d.criterios.map(c => {
    const cmd = contrato && c.verificador ? resolveCommand(contrato, c.verificador, raiz) : null
    if ((c.obrigatorio && !cmd) || (cmd && Object.keys(cmd.env).length)) throw new ErroApi(409, 'verificador_ausente', `criterios.${c.id}: configure um verificador local suportado no contrato do projeto`)
    return { id: c.id, descricao: `${c.descricao}\nResultado esperado: ${c.resultado}\nVerificacao: ${c.verificacao}`, obrigatorio: c.obrigatorio,
      ...(c.naoAplicavel ? { naoAplicavel: c.naoAplicavel } : {}),
      ...(cmd ? { comando: { binario: cmd.cmd, argumentos: cmd.args, diretorio: relative(raiz, cmd.cwd) || '.', timeoutMs: 240000 } } : {}) }
  })
  const sha256 = createHash('sha256').update(fonte.replace(/\r\n/g, '\n')).digest('hex')
  const plano: PlanoDeExecucao = { versao: 1, id: '000', repo, sessaoId: sessao, objetivo: `${d.solucao}\n\nContexto: ${d.contexto}\nEscopo: ${d.escopo}\nExclusoes: ${d.exclusoes}\nRiscos: ${d.riscos}`,
    produtoId: d.produtoId, risco: d.risco, criterios,
    microtasks: d.microtasks.map(m => ({ ...m, instrucao: `${m.instrucao}\nSaida esperada: ${m.saida}` })),
    rollout: { ativacao: d.operacao.ativacao, sucesso: d.operacao.sucesso, interrupcao: d.operacao.interrupcao, reversao: d.operacao.reversao },
    origemTecnica: { id: d.id, documento: fonte, sha256, planejamento: d.origem.planejamento, revisao: d.origem.revisao } }
  try { validarPlano(plano) } catch (e) { throw new ErroApi(400, 'plano_invalido', (e as Error).message) }
  const id = submit({ title: d.titulo, repo, desc: fonte, risk: d.risco, sessao_id: sessao, motor_modo: 'passivo', pipeline: 'auto', statusInicial: 'INBOX' })
  plano.id = id
  const salvo = salvarPlano(plano, 0, `tecnico-${sha256}`)
  patchCard(id, { plano_revisao: String(salvo.revisao), plano_hash: salvo.hash, tecnico_id: d.id, tecnico_hash: sha256, produto_id: d.produtoId }, 'documento tecnico revisado recebido; plano fixado')
  registrarPedido(sessao, id, 'passivo', fonte)
  const aprovado = approvePlan(id)
  return resposta(201, { id, sessao, modo: 'orquestrador', status: readCard(id)?.fm.status, enfileirada: aprovado.ok, mensagem: aprovado.reason, tecnicoHash: sha256 })
}

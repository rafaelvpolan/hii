// Lucio — o pacote de execucao e o que o pedinte valida ANTES de qualquer IA rodar:
// o prompt que o implementador vai receber e as recomendacoes deterministicas de
// IA por papel, agentes, skills, gates e limites. Montar o pacote nao chama IA nem
// abre worktree; o diretorio mostrado e o checkout do projeto, e a execucao real
// troca pelo worktree da tarefa.
import { createHash } from 'node:crypto'
import type { Card } from '../../cordel/index.ts'
import { repoPath } from '../../cordel/store.ts'
import { PROJECT_MEMORY } from '../../cordel/alicerce/config.ts'
import { readProjectRules } from '../../cordel/alicerce/home.ts'
import { readContract } from '../../cordel/bussola/armazenar.ts'
import { objetivoComInstrucoes } from '../../mirante/instruir.ts'
import { packsDoCard } from '../../mirante/comandos-manuais.ts'
import { modelFor, providerFor, providerNameFor } from '../../tomada/registro.ts'
import { campoDeOverrideDoPapel } from '../../tomada/rota.ts'
import type { AgentRole } from '../../tomada/tipos.ts'
import { instrucoesDosComandos } from '../../tomada/mapa/comandos.ts'
import { readProjectMemory } from '../../cascudo/memoria.ts'
import { renderizarSkills, skillsPara } from '../../cascudo/acervo.ts'
import { clarifyAnswersPrompt } from '../../agentes/clarice/clarificar.ts'
import { lerAcaoExterna } from '../../oswaldo/rota/externo.ts'
import { modoDaExecucao } from '../../oswaldo/orquestracao/config.ts'
import { agentesEscolhidos, agentesInjetaveis, contextoDeSkill, escopoDoCard, instrucoesDeAgentesNexus } from '../../ciclo/agente.ts'
import { acaoExternaPrompt, blocoDeMemoria, implementPrompt, stackOf } from '../../ciclo/prompt-de-implementacao.ts'
import { consumoDoCard, tetoDeTokensDoCard, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'
import { janelaPertoDoLimite, textoDoAviso } from '../../euclides/tesouro/aviso-de-cota.ts'
import { janelasDoProvedor } from '../../euclides/tesouro/janelas.ts'
import { activeSteps } from '../config.ts'

const PAPEIS: readonly AgentRole[] = ['implement', 'verify', 'gate', 'step']

export interface IaDoPapel {
  readonly papel: AgentRole
  readonly provedor: string
  readonly modelo: string
}

export interface PacoteDeExecucao {
  readonly versao: 1
  readonly id: string
  readonly titulo: string
  readonly repo: string
  readonly modo: string
  readonly objetivo: string
  readonly ias: readonly IaDoPapel[]
  readonly agentes: readonly string[]
  readonly skills: readonly string[]
  readonly gates: readonly string[]
  readonly portoes: readonly string[]
  readonly acaoExterna: string
  readonly limites: string
  readonly avisoDeCota: string
  readonly prompt: string
  readonly memoria: string
  readonly hash: string
}

function iasPorPapel(card: Card): IaDoPapel[] {
  return PAPEIS.map(papel => {
    const override = card.fm[campoDeOverrideDoPapel(papel)] || undefined
    return { papel, provedor: providerNameFor(papel, override), modelo: (papel === 'implement' && card.fm.orq_modelo) || modelFor(papel, override) || 'padrao do provedor' }
  })
}

function gatesDoPipeline(alvo: string, modo: string): string[] {
  if (modo === 'gateway') return ['nenhum: o modo gateway edita direto no checkout, sem worktree, gates nem PR']
  const passos = activeSteps(alvo).map(s => `${s.label}: agente ${s.agent}${s.gate !== 'none' ? `, portao ${s.gate}` : ''}`)
  return [...passos, 'crivo: revisao adversarial do diff antes do PR', 'merge sempre humano']
}

function portoesDoContrato(alvo: string, modo: string): string[] {
  if (modo === 'gateway') return []
  const comandos = readContract(alvo)?.commands
  return (['build', 'test'] as const).map(k => comandos?.[k] ? `${k}: ${comandos[k]}` : `${k}: sem script no contrato, o portao e pulado`)
}

function textoDeLimites(card: Card): string {
  const consumo = consumoDoCard(card.fm)
  const tetoTokens = tetoDeTokensDoCard()
  const semDolar = !providerFor('implement', card.fm.provider_override_implement || undefined).capabilities().reportsCostUsd
  const gasto = consumo.usd === null ? 'gasto ilegivel' : `gasto ate agora US$ ${consumo.usd.toFixed(4)}`
  return `teto US$ ${tetoDoCard()}${tetoTokens > 0 ? ` ou ${tetoTokens} tokens, o que vier primeiro` : ''}; ${gasto} e ${consumo.tokens} tokens${semDolar ? '; custo em dolar nao reportado: teto monetario nao garante a cobranca real, limite de tokens aplicado' : ''}`
}

function avisoDeCotaDe(provedor: string): string {
  try {
    const janela = janelaPertoDoLimite(janelasDoProvedor(provedor))
    return janela ? textoDoAviso(provedor, janela, '') : ''
  } catch (e) {
    return `cota de ${provedor} nao pode ser lida (${String((e as Error).message)})`
  }
}

export function hashDoPacote(p: Omit<PacoteDeExecucao, 'hash'>): string {
  // Telemetria varia durante a execucao; o contrato aprovado nao.
  const material = {
    versao: p.versao, repo: p.repo, objetivo: p.objetivo, modo: p.modo,
    acaoExterna: p.acaoExterna, ias: p.ias, agentes: p.agentes,
    skills: p.skills, gates: p.gates, portoes: p.portoes,
    prompt: p.memoria ? p.prompt.replace(blocoDeMemoria(p.memoria), '') : p.prompt,
    limites: p.limites.split(';')[0],
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16)
}

export function montarPacote(card: Card): PacoteDeExecucao {
  const id = card.fm.id ?? ''
  const alvo = repoPath(card.fm.repo ?? '')
  const modo = modoDaExecucao(card.fm)
  const objetivo = objetivoComInstrucoes(card.body, card.fm.title ?? '')
  const override = card.fm.provider_override_implement || undefined
  const provider = providerFor('implement', override)
  const acao = lerAcaoExterna(card.fm.title ?? '', objetivo)
  const ctx = contextoDeSkill(alvo, alvo, packsDoCard(card.fm.packs))
  const agentes = acao.externo ? [] : card.fm.orq_agente ? [card.fm.orq_agente] : agentesEscolhidos(ctx, `${card.fm.title ?? ''} ${objetivo}`)
  const skills = skillsPara('implementador', ctx)
  const memoria = !acao.externo && PROJECT_MEMORY ? readProjectMemory(alvo) : ''
  const prompt = acao.externo
    ? acaoExternaPrompt(acao.ferramenta, objetivo, '')
    : implementPrompt(Object.keys(agentesInjetaveis(provider, agentes, [], alvo)), instrucoesDeAgentesNexus(provider, agentes, [], alvo), instrucoesDosComandos(objetivo, alvo), alvo, objetivo, '', readProjectRules(alvo), false, clarifyAnswersPrompt(id), [], memoria, stackOf(alvo), renderizarSkills(skills), escopoDoCard(card, alvo), card.fm.rota_contexto || '')
  const semHash: Omit<PacoteDeExecucao, 'hash'> = {
    versao: 1, id, titulo: card.fm.title ?? '', repo: card.fm.repo ?? '', modo, objetivo,
    ias: iasPorPapel(card), agentes, skills: skills.map(s => s.id),
    gates: gatesDoPipeline(alvo, modo), portoes: portoesDoContrato(alvo, modo),
    acaoExterna: acao.externo ? acao.ferramenta : '', limites: textoDeLimites(card),
    avisoDeCota: avisoDeCotaDe(provider.name), prompt, memoria,
  }
  return { ...semHash, hash: hashDoPacote(semHash) }
}

function lista(itens: readonly string[], vazio: string): string {
  return itens.length ? itens.map(i => `- ${i}`).join('\n') : `- ${vazio}`
}

export function resumoDoPacote(p: PacoteDeExecucao): string {
  const implementa = p.ias.find(i => i.papel === 'implement')
  return [
    `IA que implementa: ${implementa?.provedor ?? '?'} (${implementa?.modelo ?? '?'})`,
    `agentes: ${p.agentes.join(', ') || 'nenhum'}`,
    `skills: ${p.skills.join(', ') || 'nenhuma'}`,
    `gates: ${p.gates.length} etapa(s)`,
    `limites: ${p.limites}`,
    p.avisoDeCota ? `atencao: ${p.avisoDeCota}` : '',
  ].filter(Boolean).join(' | ')
}

export function renderizarPacote(p: PacoteDeExecucao): string {
  return [
    `# Pacote de execucao #${p.id} (hash ${p.hash})`,
    '',
    `Tarefa: ${p.titulo}`,
    `Projeto: ${p.repo} · modo ${p.modo}`,
    p.acaoExterna ? `Acao externa em: ${p.acaoExterna}` : '',
    '',
    '## IA por papel',
    ...p.ias.map(i => `- ${i.papel}: ${i.provedor} (${i.modelo})`),
    '',
    '## Agentes recomendados',
    lista(p.agentes, 'nenhum agente injetado'),
    '',
    '## Skills que disparam',
    lista(p.skills, 'nenhuma skill disparou para este pedido'),
    '',
    '## Gates do pipeline',
    lista(p.gates, 'nenhum'),
    '',
    '## Portoes do contrato',
    lista(p.portoes, 'nenhum'),
    '',
    '## Limites',
    `- ${p.limites}`,
    p.avisoDeCota ? `- atencao: ${p.avisoDeCota}` : '',
    '',
    '## Prompt do implementador',
    '',
    '```text',
    p.prompt,
    '```',
    '',
  ].join('\n')
}

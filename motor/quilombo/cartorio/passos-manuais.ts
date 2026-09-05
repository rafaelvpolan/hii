import { isoNow } from '../../cordel/index.ts'
import { pipelineManual } from '../../cordel/alicerce/config.ts'
import { readCard, updateCard } from '../../cordel/store.ts'
import { activeSteps } from '../../niemeyer/config.ts'

// Cartorio — os pedidos humanos do pipeline manual (default; ver pipelineManual
// em cordel/alicerce/config.ts). A TUI (/polimento, /testes, /seguranca,
// /limpeza, /hii) e o CLI (`hii passo`, `hii pipeline`) batem AQUI, e aqui so se
// escreve intencao no card: quem executa o passo e o runner, no handleFinish de
// fechar.ts, com os mesmos gates, teto e contabilidade de qualquer execucao.
// Um caminho que rodasse o agente DENTRO da TUI travaria a interface por
// minutos e criaria um segundo ponto de execucao com gates proprios — o mesmo
// argumento do item 16 contra atalho com caminho paralelo.

export interface PedidoPipeline {
  ok: boolean
  mensagem: string
}

// /polimento e o nome que a conversa deu ao primeiro passo do pipeline
// (arquitetura, agente rufus). O alias mora aqui para TUI e CLI resolverem igual.
const ALIAS_DO_PASSO: Record<string, string> = { polimento: 'arquitetura' }

export function canonicoDoPasso(passo: string): string {
  return ALIAS_DO_PASSO[passo] ?? passo
}

function cardEmPipelineManual(id: string): { erro: string } | { status: string } {
  const card = readCard(id)
  if (!card) return { erro: `card #${id} nao encontrado` }
  const status = card.fm.status ?? ''
  // URL_OK sem marcador: o card acabou de ser aprovado e o runner ainda nao
  // pausou — o pedido chega junto e vale. PAUSED/HALTED com pipeline_pausa sao
  // o estado de repouso do modo manual (o HALTED e a falha de um passo pedido,
  // que se repete com o mesmo comando).
  if (status === 'URL_OK') {
    if (!pipelineManual(card.fm)) return { erro: `#${id} esta em pipeline automatico (pipeline: auto ou HICODE_PIPELINE=auto) — os passos ja rodam em sequencia` }
    return { status }
  }
  if (card.fm.pipeline_pausa !== 'manual') {
    return { erro: `#${id} esta em ${status} e nao e pipeline manual — para o modo antigo (tudo em sequencia) declare pipeline: auto no card ou HICODE_PIPELINE=auto` }
  }
  if (status !== 'PAUSED' && status !== 'HALTED') {
    return { erro: `#${id} esta em ${status} — passo manual so de card pausado` }
  }
  return { status }
}

// Escreve o pedido e devolve o card para URL_OK, de onde o runner pega. O
// handleFinish revalida contra o PLANO do card (perfil, needs, pipeline_feitos)
// antes de gastar qualquer chamada — pedido que nao se aplica volta a PAUSED
// com o motivo, sem custo.
export function pedirPassoManual(id: string, passo: string): PedidoPipeline {
  const r = cardEmPipelineManual(id)
  if ('erro' in r) return { ok: false, mensagem: r.erro }
  const alvo = canonicoDoPasso(passo.trim().replace(/^\//, ''))
  // Feedback imediato contra o pipeline configurado: nome errado e o erro mais
  // comum, e esperar o runner para descobrir custa uma ida e volta inteira.
  const card = readCard(id)
  const ids = activeSteps(card?.fm.worktree || undefined).map(s => s.id)
  if (!ids.includes(alvo)) {
    return { ok: false, mensagem: `passo desconhecido: "${passo}" — o pipeline tem ${ids.map(i => `/${i}`).join(' ')} (e /polimento como apelido de /arquitetura)` }
  }
  // `apesarDaParada`: tirar o card de PAUSED/HALTED e exatamente o que o humano
  // acabou de pedir — sem a flag o updateCard preserva a parada (store.ts) e o
  // pedido virava campo morto num card que nunca volta para a fila.
  updateCard(id, {
    apesarDaParada: true,
    fields: { status: 'URL_OK', retomar_em: '', pipeline_pausa: 'manual', pipeline_passo: alvo },
    log: `${isoNow()} ${r.status}->URL_OK pedido humano: rodar so o passo "${alvo}" e pausar de novo`,
  })
  return { ok: true, mensagem: `#${id} vai rodar so "${alvo}" e pausar — /hii roda o restante de uma vez` }
}

// A suite: roda o que falta do pipeline (menos o que pipeline_feitos ja pagou)
// e segue para o fecho — build, gates, push e PR. E o que o ENTER no card
// pausado faz (despacho.ts, case 'resume').
export function pedirSuiteManual(id: string): PedidoPipeline {
  const r = cardEmPipelineManual(id)
  if ('erro' in r) return { ok: false, mensagem: r.erro }
  const card = readCard(id)
  const feitos = String(card?.fm.pipeline_feitos ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const restam = activeSteps(card?.fm.worktree || undefined).filter(s => !feitos.includes(s.label)).map(s => s.id)
  updateCard(id, {
    apesarDaParada: true,
    fields: { status: 'URL_OK', retomar_em: '', pipeline_liberado: 'true', pipeline_passo: '' },
    log: `${isoNow()} ${r.status}->URL_OK pedido humano: rodar o pipeline restante de uma vez e fechar`,
  })
  return { ok: true, mensagem: `#${id} liberado — o runner roda [${restam.join(', ') || 'nada — vai direto ao fecho'}] e segue para build, gates e PR` }
}

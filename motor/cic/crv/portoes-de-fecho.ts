import { isoNow } from '../../cdl'
import type { StepMap } from '../../cdl'
import { maxReajuste } from '../../cdl/ali/config'
import { patchCard } from '../../cdl/store'
import { run } from '../../qlb/git'
import { runStep } from '../agente'
import { resolveCommand } from '../../mir/comandos'
import { addMetric } from '../../euc/metricas-de-fecho'
import { APROVADO, relatoParaHumano, repararAteOTeto, reprovado } from '../reparo'
import { escolherReparador } from '../rpr/reparadores'
import { registrarRed } from '../../agentes/chg/red-primeiro'
import { cercarSaida } from '../rpr/reparadores/tipos'
import type { VeredictoDeGate } from '../reparo'
import type { Contract, PackageInfo } from '../../cdl/bss/tipos'

export interface RunCtx {
  contract: Contract
  pkg: PackageInfo | undefined
  target: string
  // Arquivos do diff. Servem para escolher o reparador de dominio: a saida de
  // um composer quebrado nao se parece com a de um tsc quebrado.
  arquivos: readonly string[]
}

const TIMEOUT_MS = 240000
const MAX_SAIDA = 1500

interface Portao {
  readonly id: string
  readonly comando: 'build' | 'test'
  readonly agente: string
  readonly rotuloDoReajuste: string
  instrucao(saida: string, rotuloDoComando: string): string
}

const PORTAO_DE_BUILD: Portao = {
  id: 'build',
  comando: 'build',
  agente: 'rufus',
  rotuloDoReajuste: 'REAJUSTE',
  instrucao: (saida, rotulo) =>
    `O build/typecheck/lint falhou (${rotulo}).\n${cercarSaida(saida)}\nCorrija os erros de tipo/lint/build no codigo alterado sem mudar o comportamento. Nao use any nem unknown.`,
}

const PORTAO_DE_TESTE: Portao = {
  id: 'testes',
  comando: 'test',
  agente: 'testudo',
  rotuloDoReajuste: 'REAJUSTE testes',
  instrucao: (saida, rotulo) =>
    `Os testes do projeto falharam (${rotulo}).\n${cercarSaida(saida)}\nCorrija os testes ou o codigo alterado sem mudar o comportamento pretendido. Nao use any nem unknown.`,
}

interface OpcoesDoPortao {
  readonly id: string
  readonly wt: string
  readonly ctx: RunCtx
  readonly fsteps: StepMap
  readonly chaveDeTempo: string
  readonly chaveDoReajuste: string
  readonly rotuloNoCard: string
  readonly executar: typeof runStep
}

// Um portao so: build e teste diferem em qual comando roda, qual agente
// conserta e como a mensagem e escrita. O LOOP e o mesmo, e agora e o mesmo
// codigo — antes eram duas copias que ja tinham comecado a divergir.
async function portaoComReparo(portao: Portao, o: OpcoesDoPortao): Promise<boolean> {
  const cmd = resolveCommand(o.ctx.contract, portao.comando, o.wt, o.ctx.pkg)
  if (!cmd) {
    patchCard(o.id, {}, `${isoNow()} ${o.rotuloNoCard}: alvo sem script de ${portao.comando} no contrato — gate de ${portao.comando} pulado`)
    return true
  }

  // So o portao de build troca de dominio: teste continua com o testudo, que ja
  // e especialista em teste. O ganho aqui e concreto — a instrucao generica de
  // build manda "nao use any nem unknown", vocabulario de TypeScript que nao
  // significa nada num projeto PHP, Go ou Godot.
  const dominio = portao.comando === 'build' ? escolherReparador(o.ctx.arquivos) : null
  const agente = dominio?.agente ?? portao.agente
  const instrucaoDe = (saida: string): string => dominio ? dominio.instrucao(saida) : portao.instrucao(saida, cmd.label)
  if (dominio) {
    patchCard(o.id, {}, `${isoNow()} reparador de dominio: ${dominio.id} (agente ${agente}) — instrucao especifica do stack, nao a generica`)
  }

  let primeira = true
  const reparo = await repararAteOTeto({
    nome: portao.id,
    rodar: async (): Promise<VeredictoDeGate> => {
      const t0 = Date.now()
      const r = await run(cmd.cmd, cmd.args, { cwd: cmd.cwd, timeout: TIMEOUT_MS })
      if (primeira) {
        addMetric(o.fsteps, o.chaveDeTempo, { time: Math.round((Date.now() - t0) / 1000), cost: 0, tokens: 0 })
        primeira = false
        // Teste que reprova na PRIMEIRA rodada e a unica evidencia de RED que
        // o motor produz sozinho — CHG (item 5) le isto do diario depois.
        if (r.err && portao.id === 'testes' && o.id) registrarRed(o.id, `${cmd.label} reprovou antes do reparo`)
      }
      return r.err ? reprovado(String(r.stderr || r.stdout || '').slice(0, MAX_SAIDA)) : APROVADO
    },
    consertoEstreito: async (v, tentativa): Promise<string> => {
      const t0 = Date.now()
      const rr = await o.executar(o.wt, agente, instrucaoDe(v.detalhe), o.id, o.ctx.target)
      addMetric(o.fsteps, o.chaveDoReajuste, { time: Math.round((Date.now() - t0) / 1000), cost: rr.cost, tokens: rr.tokens, costMeasured: rr.costMeasured })
      patchCard(o.id, {}, `${isoNow()} ${portao.rotuloDoReajuste} (${tentativa}/${maxReajuste()}, ${agente}): ${rr.text || 'ajustou'} (custo $${rr.cost.toFixed(4)} · ${rr.tokens} tokens)`)
      if (portao.id === 'build') process.stdout.write(`[runner] #${o.id}: REAJUSTE ${tentativa} (${agente})\n`)
      return rr.text || 'ajustou'
    },
  }, maxReajuste(), o.id)

  if (reparo.veredicto.status === 'ok') {
    patchCard(o.id, {}, `${isoNow()} ${o.rotuloNoCard}: ${cmd.label} exit=0${reparo.tentativas ? ` (apos ${reparo.tentativas} reajuste)` : ''}`)
    return true
  }
  // Esgotou o teto: o humano recebe o que JA foi tentado, nao so "falhou".
  patchCard(o.id, {}, `${isoNow()} ${o.rotuloNoCard}: ${cmd.label} continua reprovando apos ${reparo.tentativas} reajuste(s) — ${relatoParaHumano(reparo)}`)
  return false
}

export function buildWithReajuste(id: string, wt: string, ctx: RunCtx, fsteps: StepMap, timeKey: string, reajusteKey: string, executar: typeof runStep = runStep): Promise<boolean> {
  return portaoComReparo(PORTAO_DE_BUILD, { id, wt, ctx, fsteps, chaveDeTempo: timeKey, chaveDoReajuste: reajusteKey, rotuloNoCard: 'build', executar })
}

export function testGate(id: string, wt: string, ctx: RunCtx, fsteps: StepMap, label: string, executar: typeof runStep = runStep): Promise<boolean> {
  return portaoComReparo(PORTAO_DE_TESTE, { id, wt, ctx, fsteps, chaveDeTempo: label, chaveDoReajuste: label, rotuloNoCard: label, executar })
}

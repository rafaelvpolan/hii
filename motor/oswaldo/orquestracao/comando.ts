import { arquivoDoOrquestrador, configDoOrquestrador, configurarOrquestrador } from './config.ts'
import { existsSync, readFileSync } from 'node:fs'
import { readCard, patchCard, normalizeId, repoPath } from '../../cordel/store.ts'
import { lerDocumentoDePlano } from './contrato.ts'
import { lerPlano, salvarPlano } from './planos.ts'
import { checkGh, checkProvider, checkContract, checkRuntimes } from '../../euclides/radar/doctor.ts'
import { fecharSessaoHii, lerSessaoHii } from '../../euclides/sessoes.ts'
import { createHash } from 'node:crypto'
import { motivoParaEsperarHarness } from '../../tomada/harness-em-voo.ts'
import { initHicodeHome } from '../../cordel/alicerce/home.ts'

export function comandoHii(projeto: string, argumento = 'on'): string[] {
  if (!projeto) return ['sem projeto: /repo <owner/nome>']
  if (argumento === 'setup') {
    const alvo = repoPath(projeto)
    if (!existsSync(alvo)) return ['projeto ausente; registre o clone antes do setup']
    const criados = initHicodeHome(alvo)
    return criados.length ? ['setup local concluido', ...criados] : ['setup local ja esta aplicado; nenhum arquivo alterado']
  }
  if (argumento.startsWith('close ')) {
    const id = normalizeId(argumento.slice(6).trim())
    if (lerSessaoHii(id)?.repo !== projeto) return ['session nao encontrada neste projeto']
    fecharSessaoHii(id)
    return [`#${id} closed`]
  }
  if (argumento === 'doctor') return [checkGh(), checkProvider(), checkContract(repoPath(projeto)), checkRuntimes(repoPath(projeto))]
    .map(c => `${c.severidade} | ${c.nome}: ${c.detalhe}${c.conserto ? ` | ${c.conserto}` : ''}`)
  if (argumento.startsWith('plan ')) {
    const [, idCru, ...partes] = argumento.split(' ')
    const id = normalizeId(idCru ?? '')
    const card = readCard(id)
    if (!card || card.fm.repo !== projeto || card.fm.motor_modo !== 'passivo') return ['plano: escolha uma execucao passiva deste projeto']
    if (!['READY', 'HALTED'].includes(card.fm.status ?? '')) return ['plano: pare a execucao antes de alterar a revisao']
    const emVoo = motivoParaEsperarHarness(id)
    if (emVoo) return [emVoo]
    const caminho = partes.join(' ').trim()
    if (!caminho) return ['uso: /hii plan <id> <arquivo.json>']
    const plano = lerDocumentoDePlano(readFileSync(caminho, 'utf8'))
    if (plano.id !== id || plano.repo !== projeto || plano.sessaoId !== card.fm.sessao_id) return ['plano: IDs da execucao, projeto e session devem coincidir']
    const atual = lerPlano(projeto, id)
    const r = salvarPlano(plano, atual?.revisao ?? 0, `import-${createHash('sha256').update(JSON.stringify(plano)).digest('hex')}`)
    patchCard(id, { plano_revisao: String(r.revisao), plano_hash: r.hash })
    return [`plano #${id} revisao ${r.revisao} validado; retome a execucao para aplicar`]
  }
  if (!['on', 'off', 'status'].includes(argumento)) return ['uso: /hii [on|off|status|doctor|setup], /hii <id>, /hii close <session>, /hii plan <id> <arquivo.json>']
  const c = argumento === 'status' ? configDoOrquestrador(projeto)
    : configurarOrquestrador(projeto, argumento === 'on' ? 'passivo' : 'gateway')
  return [
    `motor: ${c.modo} | ${projeto}`,
    c.modo === 'passivo' ? 'orquestracao ativada para os proximos pedidos; aprovacoes humanas mantidas'
      : 'gateway: pedidos diretos para a IA, sem pipeline automatico',
    `origem: ${c.revisao ? arquivoDoOrquestrador(projeto) : 'padrao'} | revisao ${c.revisao}`,
  ]
}

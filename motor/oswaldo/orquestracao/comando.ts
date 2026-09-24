import { configDoOrquestrador, configurarMicrotasks } from './config.ts'
import { existsSync, readFileSync } from 'node:fs'
import { readCard, patchCard, normalizeId, repoPath } from '../../cordel/store.ts'
import { lerDocumentoDePlano } from './contrato.ts'
import { lerPlano, salvarPlano } from './planos.ts'
import { checkGh, checkProvider, checkContract, checkRuntimes } from '../../euclides/radar/doctor.ts'
import { fecharSessaoHii, lerSessaoHii } from '../../euclides/sessoes.ts'
import { createHash } from 'node:crypto'
import { motivoParaEsperarHarness } from '../../tomada/harness-em-voo.ts'
import { planejarSetup, registrarPlanoSetup, aplicarSetup, reverterSetup } from '../../euclides/setup.ts'

export function comandoDoPipeline(projeto: string, argumento = 'status'): string[] {
  if (!projeto) return ['sem projeto: /repo <owner/nome>']
  if (argumento.startsWith('microtasks ')) {
    const quantidade = Number(argumento.slice('microtasks '.length).trim())
    const c = configurarMicrotasks(projeto, quantidade)
    return ['concorrencia de microtasks: ' + (c.concorrenciaMicrotasks ?? 1) + ' | revisao ' + c.revisao,
      'ramos em voo sao reconciliados; novos despachos respeitam o teto da fila']
  }
  if (argumento === 'setup' || argumento.startsWith('setup ')) {
    const alvo = repoPath(projeto)
    if (!existsSync(alvo)) return ['projeto ausente; registre o clone antes do setup']
    try {
      const [, acao = 'plan', hash = '', selecao] = argumento.trim().split(/\s+/)
      if (acao === 'apply') return aplicarSetup(hash, alvo, selecao?.split(',')).linhas
      if (acao === 'undo') return reverterSetup(hash, alvo).linhas
      if (acao !== 'plan') return ['uso: hii pipeline setup [plan|apply <hash> [ids]|undo <hash>] --repo <owner/nome>']
      const plano = planejarSetup(alvo)
      registrarPlanoSetup(plano)
      return ['setup plano ' + plano.hash, ...plano.passos.map(p => p.id + ': criar ' + p.tipo + ' ' + p.caminho),
        'scaffold local: nao instala ferramentas nem altera selecao efetiva de IA (preferencias/env)',
        'aplicar: hii pipeline setup apply ' + plano.hash + ' --repo ' + projeto,
        'reverter: hii pipeline setup undo ' + plano.hash + ' --repo ' + projeto]
    } catch (erro) { return ['setup recusado: ' + (erro as Error).message] }
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
    if (!caminho) return ['uso: hii pipeline plan <id> <arquivo.json> --repo <owner/nome>']
    const plano = lerDocumentoDePlano(readFileSync(caminho, 'utf8'))
    if (plano.id !== id || plano.repo !== projeto || plano.sessaoId !== card.fm.sessao_id) return ['plano: IDs da execucao, projeto e session devem coincidir']
    const atual = lerPlano(projeto, id)
    const r = salvarPlano(plano, atual?.revisao ?? 0, `import-${createHash('sha256').update(JSON.stringify(plano)).digest('hex')}`)
    patchCard(id, { plano_revisao: String(r.revisao), plano_hash: r.hash })
    return [`plano #${id} revisao ${r.revisao} validado; retome a execucao para aplicar`]
  }
  if (argumento !== 'status') return ['uso: hii pipeline <id|status|doctor|setup|plan|close|microtasks> --repo <owner/nome>']
  const c = configDoOrquestrador(projeto)
  return [`motor: gateway | ${projeto}`, 'orquestrador: /hii <tarefa ou arquivo.spec>, somente neste pedido',
    `concorrencia: ${c.concorrencia} | microtasks: ${c.concorrenciaMicrotasks ?? 1} | revisao ${c.revisao}`]
}

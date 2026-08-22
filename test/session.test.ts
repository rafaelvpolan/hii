import { test, expect } from 'bun:test'
import { handle, newSession, planShown, seguir } from '../lib/core/session'

const base = newSession('org/app')

test('texto livre vira tarefa direto, sem leitura de intencao', () => {
  const r = handle('FAQ acordeao na home', base)
  expect(r.effect.kind).toBe('submit')
  expect(r.effect.text).toBe('FAQ acordeao na home')
})

test('linha vazia sem plano pendente nao faz nada', () => {
  expect(handle('', base).effect.kind).toBe('none')
})

test('enter com plano pendente aprova e limpa o pendente', () => {
  const r = handle('', planShown(base, '042'))
  expect(r.effect.kind).toBe('approve-plan')
  expect(r.effect.id).toBe('042')
  expect(r.state.pendingPlan).toBe('')
})

test('texto livre com plano pendente descarta o plano e cria outro card', () => {
  const r = handle('outra tarefa', planShown(base, '042'))
  expect(r.effect.kind).toBe('submit')
  expect(r.state.pendingPlan).toBe('')
})

test('espaco em branco conta como enter, nao como tarefa', () => {
  expect(handle('   ', planShown(base, '042')).effect.kind).toBe('approve-plan')
})

test('/help e /historico', () => {
  expect(handle('/help', base).effect.kind).toBe('help')
  expect(handle('/historico', base).effect.kind).toBe('historico')
})

test('comando cortado nao volta pela porta dos fundos', () => {
  for (const morto of ['/cards HALTED', '/board', '/quadro', '/ask 22 sim', '/responder 22 sim', '/ls', '/plan 42', '/watch 42', '/seguir 42', '/agents 42', '/agentes 42', '/url', '/subir 42', '/ok 42', '/no 42 torto']) {
    expect(handle(morto, base).effect.kind, morto).toBe('error')
  }
})

test('/board sai do modo seguir', () => {
  expect(handle('/historico', { ...base, seguindo: '42' }).state.seguindo).toBe('')
})

test('/halt aceita motivo opcional e limpa plano pendente', () => {
  const r = handle('/halt 42 conflito com main', planShown(base, '042'))
  expect(r.effect.kind).toBe('halt')
  expect(r.effect.id).toBe('42')
  expect(r.effect.text).toBe('conflito com main')
  expect(r.state.pendingPlan).toBe('')
})

test('/halt sem motivo usa texto padrao', () => {
  expect(handle('/halt 42', base).effect.text).toBe('parado pelo humano')
})

test('/repo com nome pede validacao antes de trocar', () => {
  const r = handle('/repo org/outro', base)
  expect(r.effect.kind).toBe('pick-repo')
  expect(r.effect.text).toBe('org/outro')
})

test('/repo sem argumento reabre a lista de projetos', () => {
  expect(handle('/repo', base).effect.kind).toBe('reopen-repo')
  expect(handle('/projeto', base).effect.kind).toBe('reopen-repo')
})

test('/quit e aliases', () => {
  for (const c of ['/quit', '/exit', '/q']) expect(handle(c, base).effect.kind).toBe('quit')
})

test('comando desconhecido nao vira tarefa', () => {
  const r = handle('/naoexiste', base)
  expect(r.effect.kind).toBe('error')
  expect(r.effect.text).toContain('desconhecido')
})

test('comando nao aprova plano pendente por acidente', () => {
  expect(handle('/historico', planShown(base, '042')).state.pendingPlan).toBe('042')
})

test('REGRESSAO numero puro MOSTRA o card, nao cria tarefa chamada "20"', () => {
  for (const entrada of ['20', '020', '#20', '7']) {
    const r = handle(entrada, base)
    expect(r.effect.kind).toBe('plan')
    expect(r.effect.id).toBe(entrada.replace('#', ''))
  }
})

test('texto que so comeca com numero ainda vira tarefa', () => {
  expect(handle('2 selos no hero', base).effect.kind).toBe('submit')
})

test('numero longo demais para ser id vira tarefa', () => {
  expect(handle('12345', base).effect.kind).toBe('submit')
})

import { perguntando, respondido } from '../lib/core/session'

test('a pergunta da IA e respondida pelo prompt, sem comando dedicado', () => {
  expect(perguntando(base, '022').perguntando).toBe('022')
  expect(handle('/ask', base).effect.kind).toBe('error')
})

test('com pergunta aberta, numero RESPONDE e nao abre plano', () => {
  const s = perguntando(base, '022')
  const r = handle('2', s)
  expect(r.effect.kind).toBe('answer')
  expect(r.effect.id).toBe('022')
  expect(r.effect.text).toBe('2')
})

test('com pergunta aberta, enter vazio responde com o sugerido', () => {
  const r = handle('', perguntando(base, '022'))
  expect(r.effect.kind).toBe('answer')
  expect(r.effect.text).toBe('')
})

test('com pergunta aberta, texto livre vira resposta e nao cria card', () => {
  const r = handle('nenhum dos dois', perguntando(base, '022'))
  expect(r.effect.kind).toBe('answer')
  expect(r.effect.text).toBe('nenhum dos dois')
})

test('comando continua funcionando durante a pergunta', () => {
  expect(handle('/historico', perguntando(base, '022')).effect.kind).toBe('historico')
})

test('abrir pergunta descarta plano pendente para nao aprovar por engano', () => {
  expect(perguntando(planShown(base, '042'), '022').pendingPlan).toBe('')
})

test('respondido limpa o estado de pergunta', () => {
  expect(respondido(perguntando(base, '022')).perguntando).toBe('')
})

import { removendo } from '../lib/core/session'

test('/rm exige id e pede confirmacao antes de apagar', () => {
  expect(handle('/rm', base).effect.kind).toBe('error')
  const r = handle('/rm 23', base)
  expect(r.effect.kind).toBe('rm')
  expect(r.effect.id).toBe('23')
})

test('enter confirma a remocao, igual ao resto do hii', () => {
  const s = removendo(base, '023')
  expect(handle('', s).effect.text).toBe('sim')
  expect(handle('s', s).effect.text).toBe('sim')
  expect(handle('sim', s).effect.text).toBe('sim')
})

test('n cancela a remocao, em qualquer forma', () => {
  const s = removendo(base, '023')
  for (const nao of ['n', 'N', 'nao', 'não', 'no', 'cancelar']) {
    expect(handle(nao, s).effect.text).toBe('')
  }
})

test('confirmacao de remocao nao deixa o estado preso', () => {
  expect(handle('n', removendo(base, '023')).state.removendo).toBe('')
})

test('remocao pendente nao vira card novo nem aprova plano', () => {
  const r = handle('outra tarefa', removendo(planShown(base, '042'), '023'))
  expect(r.effect.kind).toBe('confirm-rm')
})

test('enter confirma tanto o plano quanto a remocao — mesma tecla, mesmo sentido', () => {
  expect(handle('', planShown(base, '042')).effect.kind).toBe('approve-plan')
  expect(handle('', removendo(base, '023')).effect.text).toBe('sim')
})

test('/rm aceita varios ids e separa a flag', () => {
  expect(handle('/rm 23 24 25', base).effect.id).toBe('23 24 25')
  const f = handle('/rm 23 --force', base)
  expect(f.effect.id).toBe('23')
  expect(f.effect.text).toBe('force')
})

test('/rm so com flag ainda e erro', () => {
  expect(handle('/rm --force', base).effect.kind).toBe('error')
})

test('/stop para a tarefa, igual /halt', () => {
  for (const cmd of ['/stop', '/halt', '/parar']) {
    const r = handle(`${cmd} 37`, base)
    expect(r.effect.kind).toBe('halt')
    expect(r.effect.id).toBe('37')
    expect(r.effect.text).toBe('parado pelo humano')
  }
})

test('/stop aceita motivo', () => {
  expect(handle('/stop 37 travou no build', base).effect.text).toBe('travou no build')
})

test('/stop sem id explica o uso', () => {
  const r = handle('/stop', base)
  expect(r.effect.kind).toBe('error')
  expect(r.effect.text).toContain('/stop <id>')
})

test('/stop limpa plano pendente para nao aprovar por engano', () => {
  expect(handle('/stop 37', planShown(base, '042')).state.pendingPlan).toBe('')
})

test('dentro da tarefa, texto vira instrucao e NAO tarefa nova', () => {
  const dentro = seguir(base, '022')
  const r = handle('tira tambem o selo do hero', dentro)
  expect(r.effect.kind).toBe('instruct')
  expect(r.effect.id).toBe('022')
  expect(r.effect.text).toBe('tira tambem o selo do hero')
})

test('fora da tarefa, o mesmo texto vira tarefa', () => {
  expect(handle('tira tambem o selo do hero', base).effect.kind).toBe('submit')
})

test('comando dentro da tarefa continua sendo comando', () => {
  const dentro = seguir(base, '022')
  expect(handle('/historico', dentro).effect.kind).toBe('historico')
  expect(handle('/rm 23', dentro).effect.kind).toBe('rm')
})

test('numero dentro da tarefa ainda abre o plano', () => {
  expect(handle('20', seguir(base, '022')).effect.kind).toBe('plan')
})

import { retomando } from '../lib/core/session'

test('depois de parar, enter retoma a tarefa', () => {
  const r = handle('', retomando(base, '022'))
  expect(r.effect.kind).toBe('resume')
  expect(r.effect.id).toBe('022')
  expect(r.state.retomando).toBe('')
})

test('depois de parar, escrever nao retoma — segue o caminho normal', () => {
  const dentro = { ...retomando(base, '022'), seguindo: '022' }
  const r = handle('tenta outra abordagem', dentro)
  expect(r.effect.kind).toBe('instruct')
  expect(r.state.retomando).toBe('')
})

test('comando depois de parar continua sendo comando', () => {
  expect(handle('/rm 22', retomando(base, '022')).effect.kind).toBe('rm')
})

test('retomar limpa pergunta e remocao pendentes', () => {
  const cheio = { ...planShown(base, '9'), perguntando: '9', removendo: '9' }
  const s = retomando(cheio, '022')
  expect(s.perguntando).toBe('')
  expect(s.removendo).toBe('')
  expect(s.pendingPlan).toBe('')
})

test('/exit sai, como /quit e /q', () => {
  for (const c of ['/exit', '/quit', '/q']) expect(handle(c, base).effect.kind).toBe('quit')
})

test('/exit aparece no catalogo de comandos', async () => {
  const { COMMANDS } = await import('../lib/core/session')
  expect([...COMMANDS]).toContain('/exit')
})

test('/exit sai mesmo com algo pendente', () => {
  const cheio = { ...planShown(base, '9'), perguntando: '9', removendo: '9', retomando: '9', seguindo: '9' }
  expect(handle('/exit', cheio).effect.kind).toBe('quit')
})

import { escolhendoRepo } from '../lib/core/session'

test('/repo e /project levam ao mesmo caminho', () => {
  expect(handle('/repo', base).effect.kind).toBe('reopen-repo')
  expect(handle('/project', base).effect.kind).toBe('reopen-repo')
  expect(handle('/repo acme/site', base).effect.kind).toBe('pick-repo')
  expect(handle('/project acme/site', base).effect.kind).toBe('pick-repo')
})

test('/repo com nome NAO troca direto — passa pela validacao', () => {
  const r = handle('/repo qualquer/coisa', base)
  expect(r.effect.kind).toBe('pick-repo')
  expect(r.state.repo).toBe(base.repo)
})

test('escolhendo projeto, numero e nome viram escolha', () => {
  const s = escolhendoRepo(base)
  expect(handle('2', s).effect).toMatchObject({ kind: 'pick-repo', text: '2' })
  expect(handle('acme/api', s).effect).toMatchObject({ kind: 'pick-repo', text: 'acme/api' })
})

test('escolhendo projeto, numero nao abre plano por engano', () => {
  expect(handle('20', escolhendoRepo(base)).effect.kind).toBe('pick-repo')
})

test('enter vazio desiste de escolher projeto', () => {
  const r = handle('', escolhendoRepo(base))
  expect(r.effect.kind).toBe('none')
  expect(r.state.escolhendo).toBe(false)
})

test('comando durante a escolha continua sendo comando', () => {
  expect(handle('/historico', escolhendoRepo(base)).effect.kind).toBe('historico')
})

import { ALIASES, canonico } from '../lib/core/session'

test('REGRESSAO todo apelido se comporta igual ao comando principal', () => {
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    const esperado = handle(`${principal} x`, base).effect.kind
    for (const apelido of apelidos) {
      expect(handle(`${apelido} x`, base).effect.kind, `${apelido} vs ${principal}`).toBe(esperado)
    }
  }
})

test('canonico resolve apelido e deixa comando desconhecido intacto', () => {
  expect(canonico('/project')).toBe('/repo')
  expect(canonico('/halt')).toBe('/stop')
  expect(canonico('/repo')).toBe('/repo')
  expect(canonico('/inventado')).toBe('/inventado')
})

import { sincronizarAprovacao, comentando } from '../lib/core/session'

test('a ask de aprovacao arma sozinha quando a tarefa que voce segue chega em URL', () => {
  const dentro = seguir(base, '022')
  expect(sincronizarAprovacao(dentro, 'EXECUTING').aprovando).toBe('')
  expect(sincronizarAprovacao(dentro, 'URL').aprovando).toBe('022')
})

test('a ask nao se arma por cima de outra pergunta ja na tela', () => {
  const dentro = seguir(base, '022')
  expect(sincronizarAprovacao(base, 'URL').aprovando).toBe('')
  expect(sincronizarAprovacao(comentando(dentro, '022'), 'URL').aprovando).toBe('')
  expect(sincronizarAprovacao(planShown(dentro, '019'), 'URL').pendingPlan).toBe('019')
  expect(sincronizarAprovacao(planShown(dentro, '019'), 'URL').aprovando).toBe('')
})

import { aprovando, comentando as comentandoEm } from '../lib/core/session'

test('sair da tarefa fecha a ask de aprovacao junto — ela nao pode ficar boiando sobre o quadro', () => {
  const armado = aprovando(seguir(base, '022'), '022')
  for (const saida of ['/historico', '/config']) {
    const r = handle(saida, armado)
    expect(r.state.seguindo, saida).toBe('')
    expect(r.state.aprovando, saida).toBe('')
  }
  expect(handle('/historico', comentandoEm(seguir(base, '022'), '022')).state.comentando).toBe('')
})

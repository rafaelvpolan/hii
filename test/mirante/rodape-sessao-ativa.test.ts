import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { submit, submitSession } from '../../motor/mirante/acoes.ts'
import { patchCard } from '../../motor/cordel/store.ts'
import { registrarPedido } from '../../motor/mirante/execucao-da-sessao.ts'
import { iniciarSubsessao, concluirSubsessao } from '../../motor/euclides/sessoes.ts'
import { rodapeDa } from '../../motor/mirante/cli/rodape-tui.ts'
import { newSession, seguir } from '../../motor/mirante/sessao.ts'
import { aplicar } from '../../motor/tomada/escolha-de-ia.ts'

let base = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  base = mkdtempSync(join(tmpdir(), 'hii-rodape-ativa-'))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_IA_FILE = join(base, 'ia.json')
  mkdirSync(process.env.HII_CARDS_DIR)
  aplicar({ papeis: ['implement'], provider: 'codex', model: 'configurado-modelo' })
})
afterEach(() => { process.env = env; rmSync(base, { recursive: true, force: true }) })

function tarefa(titulo: string) {
  const sessao = submitSession({ title: titulo, repo: 'org/app' })
  const id = submit({ title: titulo, repo: 'org/app', sessao_id: sessao })
  registrarPedido(sessao, id, 'gateway', titulo)
  patchCard(id, { status: 'EXECUTING' })
  return { sessao, id }
}

test('rodape distingue preferencia e chamada ativa da sessao selecionada sem vazar entre sessoes', () => {
  const a = tarefa('primeira')
  const b = tarefa('segunda')
  const subA = iniciarSubsessao(a.sessao, a.id, 'claude', 'modelo-ativo-a', 'implement')
  iniciarSubsessao(b.sessao, b.id, 'codex', 'modelo-ativo-b', 'implement')
  const tela = (id: string) => rodapeDa(seguir(newSession('org/app'), id)).join('\n')
  expect(tela(a.sessao)).toContain('ativa claude/modelo-ativo-a')
  expect(tela(a.sessao)).toContain('configurada codex/configurado-modelo')
  expect(tela(a.sessao)).not.toContain('ativa codex/modelo-ativo-b')
  expect(tela(a.id)).toContain('ativa claude/modelo-ativo-a')
  expect(tela(b.sessao)).toContain('ativa codex/modelo-ativo-b')
  expect(tela(b.sessao)).not.toContain('ativa claude/modelo-ativo-a')
  concluirSubsessao(a.sessao, subA, true)
  expect(tela(a.sessao)).not.toContain('ativa claude')
  expect(tela(a.sessao)).toContain('configurada codex/configurado-modelo')
})

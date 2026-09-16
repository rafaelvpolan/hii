import { test, expect } from '../apoio/runner.ts'
import { historicoSelecionado } from './e2e/daemon-navegacao.ts'

const titulo = 'conversa exclusiva outro'
const legenda = 'ia configurada codex · projeto e2e/outro · disco 3 KB'
const dica = '↑↓ escolhe a sessao · enter abre a tarefa · ← ou → volta'

test('titulo no eco ou historico global nao confirma a repintura do board filtrado', () => {
  expect(historicoSelecionado(`❯ /new ${titulo}\n${legenda}`, 'e2e/outro', '039')).toBe(false)
  expect(historicoSelecionado(`  #039 aberta | ${titulo}\n  #001 conversa daemon real\n${legenda}`, 'e2e/outro', '039')).toBe(false)
})

test('board selecionado precisa corresponder tanto ao projeto quanto a sessao esperados', () => {
  const tela = `> #039 aberta | ${titulo}\n${dica}\n${legenda}`
  expect(historicoSelecionado(tela, 'e2e/outro', '039')).toBe(true)
  expect(historicoSelecionado(tela, 'e2e/app', '039')).toBe(false)
  expect(historicoSelecionado(tela, 'e2e/outro', '038')).toBe(false)
  expect(historicoSelecionado(tela.replace(dica, ''), 'e2e/outro', '039')).toBe(false)
})

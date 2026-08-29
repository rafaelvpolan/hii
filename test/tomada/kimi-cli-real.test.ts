import { test, expect } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { kimiArgv, KIMI_MODOS } from '../../motor/tomada/harness/kimi.ts'
import type { AgentRequest } from '../../motor/tomada/tipos.ts'

// Por que este arquivo existe: os testes de unidade do kimi asseguravam um argv que o
// CLI REJEITA. Eles afirmavam "modo edit ganha --auto — sem ele o CLI trava esperando
// aprovacao", passavam verdes, e a verdade medida era o oposto: com `-p --auto` o
// binario aborta em ~1s ("Cannot combine --prompt with --auto") sem tocar em arquivo,
// e sem flag nenhum ele executa e escreve. Todo passo de implementacao no kimi
// falhava, e nenhum teste podia perceber porque nenhum executava o binario.
//
// Este teste executa. Ele NAO gasta chamada de modelo: as combinacoes proibidas
// falham no parse de argumentos, antes de qualquer requisicao.

function temKimi(): boolean {
  try {
    execFileSync('kimi', ['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function pedido(extra: Partial<AgentRequest> = {}): AgentRequest {
  return { prompt: 'diga ok', cwd: process.cwd(), dirs: [], mode: 'edit', useAgents: false, timeoutMs: 20000, ...extra }
}

// Roda o CLI e devolve a mensagem de erro de PARSE, se houver. Prompt vazio de
// proposito: se o argv passar no parse, o kimi ate tentaria falar com o modelo — mas
// nas combinacoes proibidas ele nem chega la.
function erroDeParse(args: string[]): string {
  try {
    execFileSync('kimi', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] })
    return ''
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string }
    const saida = `${err.stderr ?? ''}${err.stdout ?? ''}`
    return (saida.match(/error: [^\n]+/) ?? [''])[0]
  }
}

const TEM_KIMI = temKimi()

test('o CLI do kimi recusa flag de modo junto com -p — a razao do argv ser como e', () => {
  if (!TEM_KIMI) return
  for (const flag of ['--auto', '--yolo', '--plan']) {
    const erro = erroDeParse(['-p', 'oi', '--output-format', 'stream-json', flag])
    expect(erro, `se o CLI passou a ACEITAR ${flag}, revisite kimiArgv e KIMI_MODOS`).toContain('Cannot combine')
    expect(erro).toContain(flag)
  }
}, 60000)

test('o argv que o motor monta nao contem nenhuma das flags recusadas', () => {
  const a = kimiArgv(pedido())
  for (const flag of ['--auto', '--yolo', '--plan']) expect(a, flag).not.toContain(flag)
  expect(KIMI_MODOS.modos, 'catalogo nao pode oferecer modo que nunca vira flag').toEqual(['default'])
})

// Sem `--version` nao ha o que testar acima, e o proprio motor exige o binario no
// PATH (`exigeCliNoPath`). Se o kimi estiver instalado, este teste confirma que o
// nome que o adaptador usa e o nome que resolve.
test('quando o kimi esta instalado, o binario que o adaptador chama resolve no PATH', () => {
  if (!TEM_KIMI) return
  const versao = execFileSync('kimi', ['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  expect(versao, `versao lida: ${versao}`).toMatch(/^\d+\.\d+/)
}, 60000)

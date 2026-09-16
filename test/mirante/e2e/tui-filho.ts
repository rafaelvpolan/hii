import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tui } from '../../../bin/repl.ts'
import { newSession } from '../../../motor/mirante/sessao.ts'
import { nodeTerminal } from '../../../motor/mirante/tui/screen.ts'
import { allCards } from '../../../motor/cordel/store.ts'
import { executarGateway } from '../../../motor/oswaldo/gateway.ts'
import { harnessPorNome, providerNames } from '../../../motor/tomada/registro.ts'
import { aplicar } from '../../../motor/tomada/escolha-de-ia.ts'
import { cabecalhoDaChamada, carimboAgora, comRaia, linhaDeConclusao } from '../../../motor/tomada/harness/live-log.ts'
import { dispatchIOFalso } from '../../fixtures/dispatch-io-falso.ts'
import { ambienteTui } from './ambiente-tui.ts'

const base = process.argv[2]
if (!base || !existsSync(join(base, 'ambiente-e2e'))) throw new Error('Exige ambiente E2E isolado')
ambienteTui(base)
writeFileSync(join(base, 'bin', 'codex'), `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Codex iniciou o trabalho"}}'
printf '%s' parcial > parcial.txt
while [ ! -f liberar-cota ]; do sleep 0.05; done
printf '%s\\n' '{"type":"turn.failed","error":{"message":"usage limit reached: weekly limit"}}'
exit 1
`, { mode: 0o755 })
for (const nome of providerNames()) {
  const h = harnessPorNome(nome)
  h.autenticado = () => nome === 'codex' || nome === 'claude'
  if (nome !== 'codex') h.run = async () => { throw new Error(`IA real proibida: ${nome}`) }
}
harnessPorNome('claude').run = async req => {
  if (!req.prompt.includes('Preserve a API publica') || !req.prompt.includes('Continue do estado atual') ||
    readFileSync(join(req.cwd, 'parcial.txt'), 'utf8') !== 'parcial') throw new Error('Contexto perdido')
  appendFileSync(req.liveLog!, comRaia(`\n${cabecalhoDaChamada(carimboAgora(), req.rotulo)}\nClaude continuou o trabalho\n`, req.raia))
  while (!existsSync(join(req.cwd, 'liberar-fim'))) await new Promise(r => setTimeout(r, 20))
  appendFileSync(req.liveLog!, comRaia(`${linhaDeConclusao()}\n`, req.raia))
  return { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'API preservada', cost: 0,
    costMeasured: false, usage: { tokens_in: 4, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 } }
}
aplicar({ papeis: ['implement'], provider: 'codex', model: 'modelo-teste', modo: 'never' })
const iniciadas = new Set<string>()
const execucoes: Promise<void>[] = []
// Apenas o agendamento e simulado; gateway, roteador e persistencia sao de producao.
const timer = setInterval(() => {
  for (const c of allCards()) {
    if (!c.id || c.title !== 'Preserve a API publica' || c.status !== 'EXECUTING' || iniciadas.has(c.id)) continue
    iniciadas.add(c.id)
    execucoes.push(executarGateway(c.id))
  }
}, 20)
try {
  await tui(newSession('org/app'), nodeTerminal(), app => dispatchIOFalso({
    log: app.log, responder: async () => ['consulta somente leitura no E2E'], daemonOnline: () => true,
  }))
} finally {
  clearInterval(timer)
  writeFileSync(join(base, 'alvo', 'liberar-cota'), '')
  writeFileSync(join(base, 'alvo', 'liberar-fim'), '')
  await Promise.all(execucoes)
}

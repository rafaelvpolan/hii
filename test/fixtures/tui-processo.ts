import { tui } from '../../bin/repl.ts'
import { newSession } from '../../motor/mirante/sessao.ts'
import { nodeTerminal } from '../../motor/mirante/tui/screen.ts'
import { dispatchIOFalso } from './dispatch-io-falso.ts'

if (!process.env.HII_CARDS_DIR || !process.env.HII_REPOS_FILE || !process.env.HII_IA_FILE) {
  throw new Error('TUI de teste exige ambiente isolado')
}

await tui(newSession('org/app'), nodeTerminal(), app => dispatchIOFalso({
  log: app.log, daemonOnline: () => false, responder: async () => ['consulta somente leitura no PTY'],
}))

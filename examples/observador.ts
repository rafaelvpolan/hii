import { clienteHii } from '../motor/api/cliente.ts'

// Execute no backend/terminal. Credencial nunca entra no bundle do navegador.
const cliente = clienteHii(process.env.HII_API_URL || 'http://127.0.0.1:8787', process.env.HII_API_TOKEN || '')
const repo = process.env.HII_API_REPO || ''
if (process.argv.includes('--poll')) {
  // Task manager sem SSE: uma consulta; o scheduler externo decide a frequencia.
  console.log(JSON.stringify((await cliente.observarSnapshot({ repo })).valor, null, 2))
} else {
  const assinatura = cliente.observar({ repo }, p => {
    console.log(JSON.stringify({ cursor: p.cursor, degradado: p.degradado, atividades: [...p.atividades.values()].map(a => ({ id: a.id, pai: a.pai, executor: a.recurso.nome, estado: a.estado, etapa: a.etapa })) }))
  }, e => console.error(e.message))
  process.once('SIGINT', assinatura.dispose)
  process.once('SIGTERM', assinatura.dispose)
  await assinatura.concluido
}

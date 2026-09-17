// Servidor de fixture para Playwright do conector. Nao inicia daemon nem CLI IA.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'hii-http-fixture-'))
process.env.HII_CARDS_DIR = join(dir, 'cards')
process.env.HII_REPOS_FILE = join(dir, 'repos.json')
process.env.HII_IA_FILE = join(dir, 'ia.json')
process.env.HII_RUNNER_PIDFILE = join(dir, 'runner.pid')
process.env.HII_RIGOR_ESTRITO = '0'
mkdirSync(join(dir, 'repo'))
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'fixture/app', path: join(dir, 'repo') }]))
writeFileSync(join(dir, 'repo/package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
const { ensureContract } = await import('../../motor/cordel/bussola/armazenar.ts')
ensureContract(join(dir, 'repo'), new Date().toISOString())
const { controlarEntregas } = await import('./api-entrega-fixture.ts')
controlarEntregas(dir)
const { criarServidorApi } = await import('../../motor/api/servidor.ts')
const { iniciar, recurso, atualizar, saida } = await import('../../motor/observabilidade/registro.ts')
const { emptyUsage } = await import('../../motor/tomada/uso.ts')
const server = criarServidorApi(process.env.HII_API_TOKEN || '', { ...(process.env.HII_FIXTURE_ADMIN === '1' ? { admin: true } : { repos: ['fixture/app'] }), executarConsulta: async (_id, _p, req) => {
  if (req.mode !== 'readonly') throw new Error('fixture so permite leitura')
  return { ok: true, failed: false, timedOut: false, isError: false, text: 'Fixture somente leitura: nenhum card executavel criado.', detail: '', cost: 0, costMeasured: false, usage: emptyUsage() }
} })
const pai = iniciar({ repo: 'fixture/app', sessao: '001', execucao: '002' }, recurso('orquestrador', 'orchestrator'), { fixture: true })
const loop = iniciar({ repo: 'fixture/app', sessao: '001', execucao: '002' }, recurso('reparo', 'loop'), { iteracao: 2, maximo: 3 }, pai)
const chamada = iniciar({ repo: 'fixture/app', sessao: '001', execucao: '002' }, recurso('harness simulado', 'harness'), { provedorEfetivo: 'fixture', observabilidade: 'partial' }, loop)
atualizar(chamada, a => { a.estado = 'waiting_retry'; a.detalhes.motivo = 'limite temporario; aguardando backoff' })
saida(chamada, 'assistant', 'Saida incremental segura. <img src=x onerror=alert(1)>')
await new Promise<void>(resolve => server.listen(Number(process.env.HII_FIXTURE_PORT || 8789), '127.0.0.1', resolve))
process.stdout.write('fixture pronta\n')
const fechar = (): void => { server.closeAllConnections(); server.close(() => { rmSync(dir, { recursive: true, force: true }); process.exit(0) }) }
process.once('SIGTERM', fechar)
process.once('SIGINT', fechar)

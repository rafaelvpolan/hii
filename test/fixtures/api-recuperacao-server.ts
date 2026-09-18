import { criarServidorApi } from '../../motor/api/servidor.ts'
import { acompanharPresenca } from '../../motor/api/estado-motor.ts'
import { writeFileSync } from 'node:fs'
// Fixture de admissao HTTP. Nao inicia daemon, harness ou chamada de IA.
if (!process.env.HII_RECUPERACAO_FIXTURE || !process.env.HII_RUNNER_LOCK?.startsWith('/tmp/')) throw new Error('fixture exige estado temporario explicito')
writeFileSync(process.env.HII_RUNNER_LOCK, String(process.pid))
const parar = acompanharPresenca()
const servidor = criarServidorApi(process.env.HII_API_TOKEN || '')
await new Promise<void>(resolve => servidor.listen(Number(process.env.HII_FIXTURE_PORT), '127.0.0.1', resolve))
const fechar = (): void => { parar(); servidor.close(); servidor.closeAllConnections() }
process.on('SIGTERM', fechar)
process.on('SIGINT', fechar)

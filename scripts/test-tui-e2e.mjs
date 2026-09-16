import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { ambienteDaemon } from '../test/mirante/e2e/daemon-ambiente.mjs'

// O daemon externo pertence ao teste. Somente seus caminhos operacionais sao
// herdados pelo visual; a fixture deve substitui-los antes de abrir a TUI.
export async function comDaemonExterno(pasta, executarVisual) {
  mkdirSync(pasta, { recursive: true })
  const { base, env, cli } = ambienteDaemon()
  const filho = spawn(process.execPath, [resolve('runner.ts')], {
    cwd: env.HII_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let saida = ''
  let erroDoFilho
  let fechado = false
  for (const stream of [filho.stdout, filho.stderr]) stream.on('data', chunk => { saida += chunk })
  const fim = new Promise(resolve => {
    filho.once('error', erro => { erroDoFilho = erro; fechado = true; resolve(null) })
    filho.once('close', codigo => { fechado = true; resolve(codigo) })
  })
  const evidencia = { cenario: 'daemon externo privado vivo durante fixture visual', resultado: 'executando', pid: filho.pid }
  const esperarFim = async () => {
    let timer
    try {
      return await Promise.race([fim, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('daemon externo privado nao encerrou')), 8000)
      })])
    } finally { clearTimeout(timer) }
  }
  try {
    assert.ok(filho.pid, 'daemon privado precisa iniciar')
    writeFileSync(env.HII_RUNNER_PIDFILE, String(filho.pid))
    writeFileSync(`${env.HII_RUNNER_PIDFILE}.root`, env.HII_ROOT)
    writeFileSync(env.HII_RUNNER_LOG, 'log reservado ao daemon externo privado\n')
    const prazo = Date.now() + 15000
    let pronto = false
    while (Date.now() < prazo) {
      if (erroDoFilho) throw erroDoFilho
      assert.equal(fechado, false, `daemon privado encerrou no arranque: ${saida}`)
      if (existsSync(env.HII_RUNNER_LOCK) && JSON.parse(cli('estado', '--compacto')).daemon.vivo) { pronto = true; break }
      await new Promise(resolve => setTimeout(resolve, 80))
    }
    assert.ok(pronto, `daemon privado nao ficou online: ${saida}`)
    const herdado = Object.fromEntries(['HII_RUNNER_PIDFILE', 'HII_RUNNER_LOCK', 'HII_RUNNER_LOG'].map(nome => [nome, env[nome]]))
    const caminhos = [...Object.values(herdado), `${env.HII_RUNNER_PIDFILE}.root`]
    const snapshot = caminho => ({ caminho, conteudo: readFileSync(caminho, 'utf8'), modificadoEmMs: statSync(caminho).mtimeMs })
    const antes = caminhos.map(snapshot)
    writeFileSync(join(pasta, 'antes.json'), JSON.stringify(antes, null, 2))
    await executarVisual(herdado)
    assert.equal(fechado, false, 'fixture visual nao pode encerrar daemon externo')
    process.kill(filho.pid, 0)
    for (const arquivo of antes) assert.deepEqual(snapshot(arquivo.caminho), arquivo, `fixture alterou arquivo externo: ${arquivo.caminho}`)
    assert.equal(JSON.parse(cli('estado', '--compacto')).daemon.vivo, true)
    assert.equal(readdirSync(env.HII_CARDS_DIR).filter(nome => nome.endsWith('.md')).length, 0, 'fixture nao pode criar tarefas no daemon externo')
    writeFileSync(join(pasta, 'depois.json'), JSON.stringify(caminhos.map(snapshot), null, 2))
    evidencia.resultado = 'aprovado'
  } catch (erro) {
    evidencia.resultado = 'falha'
    evidencia.erro = erro instanceof Error ? erro.message : String(erro)
    throw erro
  } finally {
    try {
      if (!fechado) {
        filho.kill('SIGTERM')
        try { await esperarFim() } catch (erro) {
          evidencia.resultado = 'falha'
          evidencia.erro = erro.message
          filho.kill('SIGKILL')
          await esperarFim()
          throw erro
        }
      }
    } finally {
      writeFileSync(join(pasta, 'daemon-externo.log'), saida)
      writeFileSync(join(pasta, 'isolamento.json'), JSON.stringify(evidencia, null, 2))
      if (fechado) rmSync(base, { recursive: true, force: true })
    }
  }
}

async function main() {
  const destino = resolve(process.argv[2] || '/tmp/hii-tui-gates')
  mkdirSync(destino, { recursive: true })
  assert.equal(readdirSync(destino).length, 0, 'Escolha um destino vazio para esta rodada')
  const gates = []
  const rodar = async (script, pasta, herdado = {}) => {
    const gate = { script, pasta: pasta.slice(destino.length + 1), resultado: 'executando' }
    gates.push(gate)
    const salvar = () => writeFileSync(join(destino, 'gates.json'), JSON.stringify(gates, null, 2))
    salvar()
    const codigo = await new Promise((res, rej) => {
      const filho = spawn(process.execPath, [script, pasta], { stdio: 'inherit', env: { ...process.env, ...herdado } })
      filho.once('error', rej)
      filho.once('close', res)
    })
    gate.resultado = codigo === 0 ? 'aprovado' : 'falha'
    salvar()
    assert.equal(codigo, 0, `Gate reprovado: ${script}; evidencias em ${pasta}`)
  }
  for (let rodada = 1; rodada <= 3; rodada++) {
    const visual = herdado => rodar('test/mirante/e2e/tui-playwright.mjs', join(destino, `rodada-${rodada}`, 'tui'), herdado)
    if (rodada === 2) await comDaemonExterno(join(destino, 'rodada-2', 'isolamento-externo'), visual)
    else await visual()
    await rodar('test/mirante/e2e/daemon-playwright.mjs', join(destino, `rodada-${rodada}`, 'daemon'))
  }
  await rodar('test/mirante/e2e/relatorio-playwright.mjs', join(destino, 'relatorio'))
  console.log(`Tres rodadas limpas e gates de falha aprovados. Evidencias: ${destino}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main()

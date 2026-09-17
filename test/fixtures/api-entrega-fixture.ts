// Controle exclusivo por stdin da fixture; nunca instalado na API de producao.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { readCard, patchCard } from '../../motor/cordel/store.ts'
import { lerPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { coletarEvidencias } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { certificarEntrega } from '../../motor/oswaldo/orquestracao/entrega.ts'
export function controlarEntregas(dir: string): void {
  const repo = join(dir, 'repo'), bin = join(dir, 'bin'), dados = join(dir, 'remoto.json')
  mkdirSync(bin)
  writeFileSync(dados, '{}')
  process.env.HII_FIXTURE_ENTREGAS = dados
  const script = '#!/usr/bin/env node\nvoid (async () => { const fs = await import("node:fs"); const d = JSON.parse(fs.readFileSync(process.env.HII_FIXTURE_ENTREGAS, "utf8")); const args = process.argv.slice(2); const pr = args[0] === "pr" ? d[args[2]] : Object.values(d).find(p => args.at(-1).endsWith(p.mergeCommit.oid)); if (!pr) process.exit(1); console.log(JSON.stringify(args[0] === "pr" ? pr : {sha: pr.mergeCommit.oid, tree: {sha: pr.tree}})); })();\n'
  writeFileSync(join(bin, 'gh'), script, { mode: 0o755 })
  process.env.PATH = bin + ':' + process.env.PATH
  const git = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(repo, ['init', '-q'])
  git(repo, ['add', '.'])
  git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  createInterface({ input: process.stdin }).on('line', linha => {
    void (async () => {
      const pedido = JSON.parse(linha) as { id: string; acao: string }
      const card = readCard(pedido.id)
      if (!card || !/^\d{3,12}$/.test(pedido.id)) throw new Error('card fixture ausente')
      const pr = 'https://github.com/fixture/app/pull/' + Number(pedido.id)
      const remoto = JSON.parse(readFileSync(dados, 'utf8')) as Record<string, { url: string; state: string; headRefOid: string; tree: string; mergeCommit: { oid: string } }>
      if (pedido.acao === 'divergir') {
        remoto[pr]!.headRefOid = 'b'.repeat(40)
      } else {
        const wt = join(dir, 'entrega-' + pedido.id)
        git(repo, ['clone', '-q', repo, wt])
        const plano = lerPlano('fixture/app', pedido.id, Number(card.fm.plano_revisao))!
        const head = git(wt, ['rev-parse', 'HEAD']), tree = git(wt, ['rev-parse', 'HEAD^{tree}'])
        patchCard(pedido.id, { worktree: wt, pushed_sha: head })
        await coletarEvidencias(plano.plano, plano.revisao, wt)
        const digest = await certificarEntrega(pedido.id, wt, head, pr)
        patchCard(pedido.id, { status: 'PR_OPEN', pr_url: pr, entrega_evidencia: digest })
        patchCard(pedido.id, { status: 'MERGED' })
        rmSync(wt, { recursive: true, force: true })
        remoto[pr] = { url: pr, state: 'MERGED', headRefOid: head, tree, mergeCommit: { oid: head } }
      }
      writeFileSync(dados, JSON.stringify(remoto))
      process.stdout.write('entrega ' + pedido.acao + ' ' + pedido.id + '\n')
    })().catch(e => process.stderr.write('controle de entrega falhou: ' + (e as Error).message + '\n'))
  })
}

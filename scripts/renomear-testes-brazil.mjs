#!/usr/bin/env node
// Onda 1b — move test/ para a taxonomia BRAZIL, espelhando motor/.
//
// O dominio de cada teste vem do GRAFO DE IMPORTS (o que ele exercita), nao de
// palpite pelo nome. O nome do arquivo so muda quando cita um modulo que foi
// renomeado; qualificadores (-custo, -wait-attempts) ficam como estao, porque
// traduzi-los seria outra mudanca, com outro risco.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const RAIZ = process.cwd()
const PULAR = new Set(['node_modules', '.git'])
const EXT_TEXTO = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '.md', '.sh', '.yml'])
const EXT_MODULO = ['.ts', '.tsx', '.mts', '.mjs', '.js']
const ESPEC = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.[^'"\n]*)\2/g

// Onde a derivacao automatica erra. Cada linha e um julgamento, nao um bug.
const EXCECOES = {
  'test/commands.test.ts': 'test/mir/comandos.test.ts',
  'test/card-store.test.ts': 'test/cdl/store.test.ts',
  'test/card-store-cache.test.ts': 'test/cdl/store-cache.test.ts',
  'test/card-frontmatter.test.ts': 'test/cdl/frontmatter.test.ts',
  'test/contract-probe.test.ts': 'test/cdl/bss-sondar.test.ts',
  'test/contract-detect.test.ts': 'test/cdl/bss-detectar.test.ts',
  'test/environment-contract.test.ts': 'test/cdl/ali-contrato.test.ts',
  'test/hicode-home.test.ts': 'test/cdl/ali-home.test.ts',
  'test/config-root.test.ts': 'test/cdl/ali-config.test.ts',
  'test/failure-policy.test.ts': 'test/cic/rpr-politica.test.ts',
  'test/failure-classify.test.ts': 'test/cic/classe-de-falha.test.ts',
  'test/gated-step.test.ts': 'test/cic/passo-com-gate.test.ts',
  'test/finish-cost.test.ts': 'test/qlb/fechar-custo.test.ts',
  'test/finish-wait-attempts.test.ts': 'test/qlb/fechar-wait-attempts.test.ts',
  'test/execute-cost.test.ts': 'test/osw/executar-custo.test.ts',
  'test/execute-worktree-fate.test.ts': 'test/osw/executar-worktree-fate.test.ts',
  'test/execute-quota-fallback-off.test.ts': 'test/osw/executar-quota-fallback-off.test.ts',
  'test/queue-reconcile.test.ts': 'test/osw/fila-reconcile.test.ts',
  'test/runner-once-wakes-waiting.test.ts': 'test/osw/runner-once-acorda-espera.test.ts',
  'test/waiting-wake.test.ts': 'test/cic/espera-wake.test.ts',
  'test/correct-wait-attempts.test.ts': 'test/cic/corrigir-wait-attempts.test.ts',
  'test/mcp-estado.test.ts': 'test/tmd/pnt-estado.test.ts',
  'test/mcp.test.ts': 'test/tmd/pnt-mcp.test.ts',
  'test/mcp-escopo.test.ts': 'test/tmd/pnt-escopo.test.ts',
  'test/comandos-da-ia.test.ts': 'test/tmd/map-comandos.test.ts',
  'test/cache.test.ts': 'test/tmd/eco-memo.test.ts',
  'test/cota-cache.test.ts': 'test/euc/tsr-cota-cache.test.ts',
  'test/daemon-health.test.ts': 'test/euc/rdr-tick.test.ts',
  'test/saude-motor.test.ts': 'test/euc/rdr-saude.test.ts',
  'test/progress-custo-piso.test.ts': 'test/euc/rdr-progresso-custo-piso.test.ts',
  'test/podar-registros.test.ts': 'test/euc/podar.test.ts',
  'test/ideate.test.ts': 'test/agentes/tsl-ideacao.test.ts',
  'test/analyze.test.ts': 'test/osw/rta-perfil.test.ts',
  'test/classify.test.ts': 'test/osw/rta-superficie.test.ts',
  'test/instance-lock.test.ts': 'test/osw/mtr-trava-instancia.test.ts',
  'test/file-lock.test.ts': 'test/osw/mtr-trava-arquivo.test.ts',
  'test/daemon-arranque.test.ts': 'test/osw/mtr-daemon-arranque.test.ts',
  'test/health-probe.test.ts': 'test/tmd/sonda.test.ts',
  'test/registry-provedores.test.ts': 'test/tmd/registro-provedores.test.ts',
  'test/ai-usage.test.ts': 'test/tmd/uso.test.ts',
  'test/session.test.ts': 'test/mir/sessao.test.ts',
  'test/activity.test.ts': 'test/mir/atividade.test.ts',
  'test/complete.test.ts': 'test/mir/completar.test.ts',
  'test/archive.test.ts': 'test/cdl/arquivar.test.ts',
  'test/core-actions.test.ts': 'test/mir/acoes.test.ts',
  'test/core-repos.test.ts': 'test/cdl/repos.test.ts',
  'test/plan-render.test.ts': 'test/nmy/luc-plano-render.test.ts',
  'test/private-net-literal.test.ts': 'test/qlb/alf-rede-privada-literal.test.ts',
  'test/refs-anexo.test.ts': 'test/qlb/alf-anexo.test.ts',
  'test/finish-pushed-sha.test.ts': 'test/qlb/fechar-pushed-sha.test.ts',
  // ficam na raiz: nao exercitam motor/, exercitam scripts/ ou o proprio mapa
  'test/no-any-detect.test.ts': 'test/no-any-detect.test.ts',
  'test/scripts-setup-imports.test.ts': 'test/scripts-setup-imports.test.ts',
  'test/mapa-de-rename.test.ts': 'test/mapa-de-rename.test.ts',
  'test/isolamento-de-testes.test.ts': 'test/isolamento-de-testes.test.ts',
}

function dominioPorImport(caminho) {
  const texto = readFileSync(caminho, 'utf8')
  const contagem = {}
  for (const m of texto.matchAll(ESPEC)) {
    const mm = /\.\.\/motor\/([a-z]+)\//.exec(m[3])
    if (mm) contagem[mm[1]] = (contagem[mm[1]] ?? 0) + 1
  }
  const ord = Object.entries(contagem).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return ord[0]?.[0] ?? ''
}

export function mapaDosTestes() {
  const fora = new Map()
  for (const nome of readdirSync('test')) {
    if (!nome.endsWith('.test.ts')) continue
    const origem = join('test', nome)
    const excecao = EXCECOES[origem]
    if (excecao !== undefined) { fora.set(origem, excecao); continue }
    const dom = dominioPorImport(origem)
    fora.set(origem, dom ? `test/${dom}/${nome}` : origem)
  }
  return [...fora].filter(([o, d]) => o !== d).sort((a, b) => a[0].localeCompare(b[0]))
}

function arquivosDeTexto() {
  const acc = []
  const anda = dir => {
    for (const n of readdirSync(dir)) {
      if (PULAR.has(n)) continue
      const p = join(dir, n)
      if (statSync(p).isDirectory()) anda(p)
      else if (EXT_TEXTO.has(extname(p))) acc.push(relative(RAIZ, p))
    }
  }
  anda(RAIZ)
  return acc
}

function resolverAlvo(de, spec) {
  const base = relative(RAIZ, resolve(RAIZ, dirname(de), spec))
  if (extname(base) && existsSync(base)) return base
  for (const e of EXT_MODULO) if (existsSync(base + e)) return base + e
  for (const e of EXT_MODULO) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e)
  return null
}

function novoSpec(deNovo, alvoNovo, specAntigo) {
  let d = alvoNovo
  if (!/\.(ts|tsx|mts|mjs|js)$/.test(specAntigo)) {
    d = d.replace(/\.(ts|tsx|mts|mjs|js)$/, '')
    if (d.endsWith('/index') && !specAntigo.endsWith('/index')) d = dirname(d)
  }
  let rel = relative(dirname(deNovo), d).split('\\').join('/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

// Caminhos que reescrita de import nao alcanca. Mover teste para subpasta
// muda a PROFUNDIDADE, entao qualquer raiz calculada a mao quebra em silencio.
// Foi exatamente o que aconteceu na primeira passada: 30 testes reprovaram.
const NAO_ALCANCAVEL = [
  [/join\(\s*import\.meta\.dir\s*,\s*['"`]\.\.['"`]\s*\)/g, "raiz calculada com um unico '..'"],
  [/(?<!dirname\()dirname\(\s*import\.meta\.dir\s*\)/g, 'raiz calculada com um unico dirname()'],
  [/import\(\s*`[^`]*\.\.\/[^`]*`/g, 'import() com template literal'],
  [/join\(\s*import\.meta\.dir\s*,\s*['"`](?!\.\.)/g, 'caminho relativo ao proprio arquivo de teste'],
]

export function caminhosNaoAlcancaveis() {
  const achados = []
  const anda = dir => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { anda(p); continue }
      if (!p.endsWith('.ts')) continue
      const texto = readFileSync(p, 'utf8')
      for (const [rx, motivo] of NAO_ALCANCAVEL) {
        for (const m of texto.matchAll(rx)) {
          achados.push({ arquivo: p, linha: texto.slice(0, m.index).split('\n').length, motivo, trecho: m[0].slice(0, 60) })
        }
      }
    }
  }
  anda('test')
  return achados
}

const ESTE_SCRIPT = fileURLToPath(import.meta.url)
const invocadoDiretamente = process.argv[1] !== undefined && resolve(process.argv[1]) === ESTE_SCRIPT

if (invocadoDiretamente) {
  const lote = mapaDosTestes()
  const destinos = new Set()
  for (const [o, d] of lote) {
    if (destinos.has(d)) { process.stderr.write(`destino duplicado: ${d}\n`); process.exit(1) }
    if (existsSync(d)) { process.stderr.write(`destino ja ocupado: ${d}\n`); process.exit(1) }
    destinos.add(d)
  }
  process.stdout.write(`${lote.length} arquivo(s) de teste a mover\n`)
  if (!process.argv.includes('--aplicar')) {
    for (const [o, d] of lote) process.stdout.write(`  ${o}  ->  ${d}\n`)
    process.stdout.write('\ndry-run — nada escrito.\n')
    process.exit(0)
  }

  const foto = new Map()
  for (const arquivo of arquivosDeTexto()) {
    const texto = readFileSync(arquivo, 'utf8')
    const itens = []
    for (const m of texto.matchAll(ESPEC)) {
      const alvo = resolverAlvo(arquivo, m[3])
      if (alvo) itens.push({ spec: m[3], alvo })
    }
    if (itens.length) foto.set(arquivo, itens)
  }
  const renomeados = new Map(lote)
  for (const [o, d] of lote) { mkdirSync(dirname(d), { recursive: true }); execFileSync('git', ['mv', o, d], { cwd: RAIZ }) }

  let tocados = 0
  for (const [antigo, itens] of foto) {
    const local = renomeados.get(antigo) ?? antigo
    if (!existsSync(local)) continue
    const antes = readFileSync(local, 'utf8')
    const porSpec = new Map()
    for (const { spec, alvo } of itens) {
      const alvoNovo = renomeados.get(alvo) ?? alvo
      if (alvoNovo === alvo && local === antigo) continue
      porSpec.set(spec, novoSpec(local, alvoNovo, spec))
    }
    if (!porSpec.size) continue
    const depois = antes.replace(ESPEC, (todo, pre, q, spec) => {
      const novo = porSpec.get(spec)
      return novo ? `${pre}${q}${novo}${q}` : todo
    })
    if (depois !== antes) { writeFileSync(local, depois); tocados++ }
  }
  process.stdout.write(`aplicado: ${lote.length} movido(s), ${tocados} arquivo(s) com import reescrito\n`)
  const manuais = caminhosNaoAlcancaveis()
  if (manuais.length) {
    process.stdout.write(`\nREVISAR A MAO — ${manuais.length} caminho(s) sensiveis a profundidade:\n`)
    for (const m of manuais) process.stdout.write(`  ${m.arquivo}:${m.linha}  ${m.motivo}\n    ${m.trecho}\n`)
  }
}

import { test, expect } from '../apoio/runner.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// REGRA INEGOCIAVEL: docker compose e proibido neste projeto. A orquestracao e
// docker swarm (`docker stack deploy`).
//
// O motivo tecnico nao e gosto: em compose o bloco `deploy.resources.limits` e
// IGNORADO. O item 32 existe para impor teto de cpu e memoria por worktree — num
// arquivo de compose esse teto seria decorativo, e teto decorativo e pior que
// teto nenhum, porque parece que existe.
//
// Regra que so vive em documento e regra que a proxima pessoa nao sabe que
// existe. Aqui ela reprova a suite.

const IGNORAR = new Set(['node_modules', '.git', 'snapshots', 'receipts'])

function todosOsArquivos(raiz = '.'): string[] {
  return readdirSync(raiz).flatMap(nome => {
    if (IGNORAR.has(nome)) return []
    const caminho = join(raiz, nome)
    return statSync(caminho).isDirectory() ? todosOsArquivos(caminho) : [caminho]
  })
}

const ARQUIVO_DE_COMPOSE = /(?:^|\/)(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/i
const INVOCA_COMPOSE = /docker[- ]compose\s+(?:up|down|run|build|logs|ps|exec|pull|config|stop|start|restart)\b/i

const ARQUIVOS = todosOsArquivos()

test('a varredura enxerga o repo — senao os dois invariantes passariam vazios', () => {
  expect(ARQUIVOS.length).toBeGreaterThan(200)
})

test('PROIBIDO nenhum arquivo de compose existe no projeto', () => {
  const achados = ARQUIVOS.filter(f => ARQUIVO_DE_COMPOSE.test(f))
  expect(achados, 'a orquestracao deste projeto e docker swarm — use docker-stack.yml').toEqual([])
})

test('PROIBIDO nada no projeto invoca docker compose', () => {
  const achados = ARQUIVOS
    .filter(f => /\.(?:ts|mjs|js|sh|yml|yaml|md|json)$/.test(f))
    .filter(f => f !== join('.', 'test', 'cdl', 'sem-compose.test.ts'))
    .filter(f => INVOCA_COMPOSE.test(readFileSync(f, 'utf8')))
  expect(achados, 'em compose o deploy.resources.limits e ignorado — o teto do item 32 viraria decoracao').toEqual([])
})

test('a regra esta declarada em config/regras-inegociaveis.json, nao so neste teste', async () => {
  const { lerRegras } = await import('../../motor/csd/lei/guarda.ts')
  const regra = lerRegras().find(r => /compose/i.test(r.descricao))
  expect(regra, 'regra que so vive em teste ninguem le antes de escrever o arquivo errado').toBeDefined()
  expect(regra?.gatilho.arquivos?.length).toBeGreaterThan(0)
})

test('o stack de swarm existe e declara o teto de recurso que o compose ignoraria', () => {
  const stack = readFileSync('docker-stack.yml', 'utf8')
  expect(stack).toContain('deploy:')
  expect(stack).toContain('limits')
  const temChaveBuild = stack.split('\n').some(l => l.trim().startsWith('build:'))
  expect(temChaveBuild, 'o swarm IGNORA build: em silencio (exit 0) em vez de recusar — quem barra tem de ser este teste, senao sobe a imagem velha achando que construiu').toBe(false)
})

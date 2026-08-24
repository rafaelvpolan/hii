#!/usr/bin/env node
// Monta o PLANO da auditoria manual (`/verificar`) e imprime resumo + lotes.
//
// Existe como script, e nao como trecho de shell dentro do SKILL.md, por dois
// motivos. Primeiro: `apenas` — o recorte por lista exata de caminhos — nao tinha
// nenhum chamador de codigo, so prosa num documento, e opcao sem chamador e
// exatamente o "valor computado e nunca aplicado" que esta auditoria persegue.
// Segundo: o recorte por BRANCH precisa consultar o git, e um snippet de `-e`
// inline com git embutido nao tem como ser testado.
//
// Uso:
//   auditar.ts                          repositorio inteiro
//   auditar.ts motor/agentes/           recorte por prefixo de caminho
//   auditar.ts --branch [--base main]   so a superficie desta branch
//   auditar.ts --lotes 3 --orcamento 40000
import { execFileSync } from 'node:child_process'
import {
  renderLote, resumoAuditoria, selecionarAuditoria,
} from '../motor/agentes/ass/auditoria.ts'

export interface Argumentos {
  readonly escopo: string
  readonly branch: boolean
  readonly base: string
  readonly lotes: number
  readonly orcamento: number
}

// `--branch` e BOOLEANA: tratar o argumento seguinte como valor dela fazia
// `auditar.ts --branch motor/agentes/` perder o escopo em silencio e auditar bem
// mais do que se pediu.
const FLAGS_BOOLEANAS = new Set(['--branch'])

export function lerArgumentos(argv: readonly string[]): Argumentos {
  // Valor que comeca com '--' e outra FLAG, nao valor: `--base --lotes 3` fazia
  // base='--lotes', e o plano saia rotulado "superficie da branch vs --lotes".
  const valor = (nome: string): string => {
    const i = argv.indexOf(nome)
    if (i < 0) return ''
    const bruto = argv[i + 1] ?? ''
    if (!bruto || bruto.startsWith('--')) {
      process.stderr.write(`[auditar] ${nome} veio sem valor — usando o padrao
`)
      return ''
    }
    return bruto
  }
  const soltos = argv.filter((a, i) => {
    if (a.startsWith('--')) return false
    const anterior = String(argv[i - 1] ?? '')
    return !(anterior.startsWith('--') && !FLAGS_BOOLEANAS.has(anterior))
  })
  return {
    escopo: soltos[0] ?? '',
    branch: argv.includes('--branch'),
    base: valor('--base') || 'main',
    lotes: Number(valor('--lotes') || 0) || 0,
    orcamento: Number(valor('--orcamento') || 0) || 0,
  }
}

// `git status --porcelain` traz DOIS caracteres de status, um espaco, e o caminho —
// e o primeiro caractere e espaco quando a mudanca so existe na arvore (' M x').
// Dar `.trim()` na linha antes de cortar o status come esse espaco e faz o corte
// errar: ' M a.ts' virava 'M a.ts', e o caminho saia com a letra colada. Nesta
// forma o corte e por POSICAO, que e o que o formato garante.
export function caminhosDoStatus(saida: string): string[] {
  const fora: string[] = []
  for (const linha of saida.split('\n')) {
    if (linha.length < 4) continue
    const caminho = linha.slice(3).trim()
    if (!caminho) continue
    // Rename/copy vem como "old -> new": interessa o destino.
    fora.push(caminho.includes(' -> ') ? (caminho.split(' -> ').pop() ?? caminho) : caminho)
  }
  return fora
}

// Superficie da branch = o que ainda nao foi commitado + o que o diff vs a base
// mostra. A uniao, porque o trabalho em curso conta.
export function arquivosDaBranch(base: string, git: (args: string[]) => string): string[] {
  const naoCommitados = caminhosDoStatus(git(['status', '--porcelain']))
  let commitados: string[] = []
  try {
    commitados = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    // Branch sem ancestral comum com a base (ou base inexistente): o que esta
    // fora do commit ainda vale, e dizer isso e melhor que devolver lista vazia
    // fingindo que nao ha nada.
    process.stderr.write(`[auditar] nao consegui comparar com ${base} — a lista cobre so o que ainda nao foi commitado\n`)
  }
  return [...new Set([...naoCommitados, ...commitados])]
}

function gitReal(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' })
}

export async function planoDaAuditoria(a: Argumentos, git: (args: string[]) => string = gitReal): Promise<string[]> {
  // FAIL-OPEN DE ESCOPO, e por isso a saida antecipada: `apenas: []` significa "sem
  // recorte por lista", ou seja REPO INTEIRO. Com `--branch` numa arvore limpa (ou
  // base sem ancestral comum) a lista vinha vazia e o plano do repositorio todo saia
  // rotulado como "superficie da branch" — e `resumoAuditoria` so avisa de recorte
  // vazio para `escopo`, nunca para `apenas`, entao nada denunciava a troca.
  const daBranch = a.branch ? arquivosDaBranch(a.base, git) : []
  if (a.branch && !daBranch.length) {
    return [
      `auditoria manual: 0 de 0 arquivo(s) — a superficie desta branch vs ${a.base} esta VAZIA`,
      'nada foi auditado, e isto NAO e "repositorio limpo": rode sem --branch para auditar o repositorio inteiro',
    ]
  }
  const p = await selecionarAuditoria({
    escopo: a.escopo,
    maxLotes: a.lotes,
    orcamentoChars: a.orcamento || undefined,
    apenas: daBranch,
  })
  const fora = [resumoAuditoria(p)]
  if (a.branch) {
    fora.push(`recorte: superficie da branch vs ${a.base} (${daBranch.length} arquivo(s) tocados) — a cobertura declarada vale para ELA, nao para o repositorio`)
  }
  for (const l of p.lotes) fora.push('', renderLote(l, p.lotes.length))
  return fora
}

// `import.meta.main` no bun; sob node o arquivo so roda quando invocado direto.
const executando = typeof Bun !== 'undefined'
  ? import.meta.main
  : process.argv[1]?.endsWith('auditar.ts') === true

if (executando) {
  for (const linha of await planoDaAuditoria(lerArgumentos(process.argv.slice(2)))) {
    process.stdout.write(`${linha}\n`)
  }
}

import { test, expect } from '../apoio/runner.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// A superficie de CLI do `hii` nao tinha guarda nenhuma, e a auditoria achou dois
// defeitos ali: `hii approve` sem id respondia "uso: hii aprovar-url <id>" — nome
// da ACAO interna, comando que nao existe no switch — e `hii estado [--json]`
// documentava uma flag que nenhuma linha lia.

const BRUTO = readFileSync('bin/hii.ts', 'utf8')

// A varredura olha CODIGO, nao comentario — a mesma licao que o resto da suite
// aprendeu: um comentario explicando o defeito ANTIGO ("respondia uso: hii
// aprovar-url") reprovava o invariante que existe para pegar o defeito.
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .map(l => l.replace(/\s\/\/.*$/, ''))
    .join('\n')
}

const FONTE = semComentarios(BRUTO)

// bin/hii.ts mais os scripts a que ele delega (`script(...)` chama scripts/setup/*).
function ondeSeLeFlag(): string {
  const dirs = ['scripts', join('scripts', 'setup')]
  const partes = [FONTE]
  for (const d of dirs) {
    for (const nome of readdirSync(d)) {
      if (!nome.endsWith('.mjs')) continue
      partes.push(semComentarios(readFileSync(join(d, nome), 'utf8')))
    }
  }
  return partes.join('\n')
}

// Os `case 'x':` do switch de main(), que e a lista do que o binario aceita.
function comandosAceitos(): string[] {
  return [...new Set([...FONTE.matchAll(/^\s*case '([a-z-]+)':/gm)].map(m => m[1] ?? ''))].filter(Boolean)
}

function textoDoUsage(): string {
  const i = FONTE.indexOf('function usage()')
  expect(i, 'usage() sumiu de bin/hii.ts').toBeGreaterThan(-1)
  const fim = FONTE.indexOf('\n}', i)
  return FONTE.slice(i, fim)
}

test('a varredura enxerga os comandos — senao os invariantes abaixo passariam vazios', () => {
  expect(comandosAceitos().length, 'nenhum case encontrado: a regex quebrou').toBeGreaterThan(10)
})

test('nenhuma mensagem de uso cita comando que o switch nao aceita', () => {
  const aceitos = new Set(comandosAceitos())
  // Toda ocorrencia de `hii <palavra>` em string do arquivo tem de ser um comando real.
  const citados = [...FONTE.matchAll(/uso: hii ([a-z-]+)/g)].map(m => m[1] ?? '')
  expect(citados.length, 'nenhuma mensagem de uso encontrada: a regex quebrou').toBeGreaterThan(0)
  const inexistentes = [...new Set(citados)].filter(c => !aceitos.has(c))
  expect(inexistentes, 'a ajuda manda o humano rodar comando que nao existe').toEqual([])
})

// As flags que o proprio binario resolve. `--help` e resolvida pelo switch de
// comandos (case '--help'), nao por leitura de flag, e por isso fica de fora.
const RESOLVIDAS_PELO_SWITCH = new Set(['help', 'h'])

test('toda flag documentada no usage e de fato lida pelo codigo', () => {
  const flags = [...new Set([...textoDoUsage().matchAll(/--([a-z-]+)/g)].map(m => m[1] ?? ''))]
    .filter(f => !RESOLVIDAS_PELO_SWITCH.has(f))
  expect(flags.length, 'nenhuma flag no usage: a regex quebrou').toBeGreaterThan(1)
  // Basta o literal aparecer no CODIGO (nao em comentario): a forma de ler varia
  // — includes, valorDaFlag, delegacao a outro modulo — e prender a forma seria
  // invariante sobre estilo, nao sobre comportamento.
  //
  // O escopo inclui os SCRIPTS aos quais o binario delega: `hii rm --yes` e
  // `hii archive --dry-run` sao lidos em scripts/setup/, e checar so bin/hii.ts
  // acusaria flag honrada de nao ser lida.
  const naoLidas = flags.filter(f => !ondeSeLeFlag().includes(`'--${f}'`))
  expect(naoLidas, 'flag anunciada e nunca consultada e promessa que o codigo nao cumpre').toEqual([])
})

test('a varredura de flags ignora comentario — senao ela reprova documentacao', () => {
  expect(semComentarios("// process.argv.includes('--fantasma')")).not.toContain('--fantasma')
  expect(semComentarios("if (a.includes('--real')) {}")).toContain('--real')
})

test('COMANDO_DA_ACAO cobre toda AcaoDeTarefa — e o compilador nao deixa faltar', () => {
  const tipos = readFileSync('motor/mir/comandos-de-tarefa.ts', 'utf8')
  const acoes = (tipos.match(/export type AcaoDeTarefa = ([^\n]+)/)?.[1] ?? '')
    .split('|').map(s => s.trim().replace(/'/g, '')).filter(Boolean)
  expect(acoes.length).toBeGreaterThan(3)
  for (const a of acoes) {
    expect(FONTE, `${a} sem comando de CLI declarado`).toContain(a.includes('-') ? `'${a}':` : `${a}:`)
  }
})

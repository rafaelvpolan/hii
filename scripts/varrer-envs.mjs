// Varredura deterministica das variaveis HICODE_* no codigo executavel, e o
// reescritor do apendice gerado em OPERACAO.md. O raio-x mediu 68 de 97 envs
// fora do manual — incluindo knobs de custo e timeout — e uma env documentada
// que nenhuma linha lia. Doc de env gerada do codigo nao deriva; o teste
// test/cordel/operacao-envs.test.ts reprova quando alguem cria uma env nova e
// nao roda `node scripts/varrer-envs.mjs`.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const FONTES = ['motor', 'bin', 'scripts', 'runner.ts']
const EXTENSOES = ['.ts', '.mjs', '.sh']
const RE_ENV = /HICODE_[A-Z0-9_]{2,}/g
const MARCA_INICIO = '<!-- hicode:envs:inicio -->'
const MARCA_FIM = '<!-- hicode:envs:fim -->'

function arquivosDeCodigo(caminho) {
  const st = statSync(caminho)
  if (st.isFile()) return EXTENSOES.some(e => caminho.endsWith(e)) ? [caminho] : []
  return readdirSync(caminho).flatMap(n => arquivosDeCodigo(join(caminho, n)))
}

export function varrerEnvs(raiz = RAIZ) {
  const porEnv = new Map()
  for (const fonte of FONTES) {
    for (const arquivo of arquivosDeCodigo(join(raiz, fonte))) {
      const texto = readFileSync(arquivo, 'utf8')
      for (const nome of texto.match(RE_ENV) ?? []) {
        const onde = porEnv.get(nome) ?? new Set()
        onde.add(relative(raiz, arquivo))
        porEnv.set(nome, onde)
      }
    }
  }
  return new Map([...porEnv.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function tabelaDeEnvs(porEnv) {
  const linhas = ['| Variável | Lida em |', '|---|---|']
  for (const [nome, onde] of porEnv) {
    const arquivos = [...onde].sort()
    const mostrados = arquivos.slice(0, 3).map(a => `\`${a}\``).join(', ')
    const resto = arquivos.length > 3 ? ` (+${arquivos.length - 3})` : ''
    linhas.push(`| \`${nome}\` | ${mostrados}${resto} |`)
  }
  return linhas.join('\n')
}

export function reescreverApendice(doc, tabela) {
  const inicio = doc.indexOf(MARCA_INICIO)
  const fim = doc.indexOf(MARCA_FIM)
  if (inicio < 0 || fim < 0 || fim < inicio) {
    throw new Error(`OPERACAO.md sem os marcadores ${MARCA_INICIO} / ${MARCA_FIM} — o apendice gerado nao tem onde morar`)
  }
  return `${doc.slice(0, inicio + MARCA_INICIO.length)}\n${tabela}\n${doc.slice(fim)}`
}

const rodandoDireto = process.argv[1] && fileURLToPath(new URL(import.meta.url)).endsWith(relative('.', process.argv[1]))
if (rodandoDireto) {
  const caminho = join(RAIZ, 'OPERACAO.md')
  const doc = readFileSync(caminho, 'utf8')
  const porEnv = varrerEnvs()
  writeFileSync(caminho, reescreverApendice(doc, tabelaDeEnvs(porEnv)))
  process.stdout.write(`OPERACAO.md: apendice de envs regravado com ${porEnv.size} variaveis\n`)
}

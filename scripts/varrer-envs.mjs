// Varredura deterministica das variaveis HII_* no codigo executavel, e o
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
const CONTRATO = join('motor', 'cordel', 'alicerce', 'contrato.ts')
const RE_ENV = /HII_[A-Z0-9_]{2,}/g
const RE_PADRAO = /process\.env\.(HII_[A-Z0-9_]{2,})\s*(?:\|\||\?\?)\s*('[^']*'|"[^"]*"|-?\d[\d_]*(?:\.\d+)?)/g
const RE_CONSTANTE = /export const (ENV_[A-Z0-9_]+) = '(HII_[A-Z0-9_]+)'/g
const RE_ENTRADA = /\{ nome: (ENV_[A-Z0-9_]+), precisaSerCompartilhadaEntreClones: (true|false), resolvidoPor: \[[^\]]*\], lado: '(\w+)' \}/g
const MARCA_INICIO = '<!-- hicode:envs:inicio -->'
const MARCA_FIM = '<!-- hicode:envs:fim -->'
const VAZIO = '—'

function arquivosDeCodigo(caminho) {
  const st = statSync(caminho)
  if (st.isFile()) return EXTENSOES.some(e => caminho.endsWith(e)) ? [caminho] : []
  return readdirSync(caminho).flatMap(n => arquivosDeCodigo(join(caminho, n)))
}

function textosDeCodigo(raiz) {
  const textos = []
  for (const fonte of FONTES) {
    for (const arquivo of arquivosDeCodigo(join(raiz, fonte))) {
      textos.push([relative(raiz, arquivo), readFileSync(arquivo, 'utf8')])
    }
  }
  return textos
}

function ordenado(mapa) {
  return new Map([...mapa.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

function acumular(mapa, chave, valor) {
  const conjunto = mapa.get(chave) ?? new Set()
  conjunto.add(valor)
  mapa.set(chave, conjunto)
}

export function varrerEnvs(raiz = RAIZ) {
  const porEnv = new Map()
  for (const [arquivo, texto] of textosDeCodigo(raiz)) {
    for (const nome of texto.match(RE_ENV) ?? []) acumular(porEnv, nome, arquivo)
  }
  return ordenado(porEnv)
}

export function varrerPadroes(raiz = RAIZ) {
  const porEnv = new Map()
  for (const [, texto] of textosDeCodigo(raiz)) {
    for (const m of texto.matchAll(RE_PADRAO)) acumular(porEnv, m[1], m[2])
  }
  return ordenado(porEnv)
}

export function lerContrato(raiz = RAIZ) {
  const texto = readFileSync(join(raiz, CONTRATO), 'utf8')
  const nomes = new Map([...texto.matchAll(RE_CONSTANTE)].map(m => [m[1], m[2]]))
  const porEnv = new Map()
  for (const m of texto.matchAll(RE_ENTRADA)) {
    const nome = nomes.get(m[1])
    if (nome) porEnv.set(nome, { lado: m[3], compartilhada: m[2] === 'true' })
  }
  return porEnv
}

function celulaDePadrao(literais) {
  if (!literais || literais.size === 0) return VAZIO
  return [...literais].sort().map(l => `\`${l.replace(/\|/g, '\\|')}\``).join(', ')
}

function celulaDeContrato(entrada) {
  if (!entrada) return VAZIO
  return entrada.compartilhada ? `${entrada.lado}, compartilhada entre clones` : entrada.lado
}

export function tabelaDeEnvs(porEnv, padroes = new Map(), contrato = new Map()) {
  const linhas = ['| Variável | Padrão no código | Contrato motor/painel | Lida em |', '|---|---|---|---|']
  for (const [nome, onde] of porEnv) {
    const arquivos = [...onde].sort()
    const mostrados = arquivos.slice(0, 3).map(a => `\`${a}\``).join(', ')
    const resto = arquivos.length > 3 ? ` (+${arquivos.length - 3})` : ''
    linhas.push(`| \`${nome}\` | ${celulaDePadrao(padroes.get(nome))} | ${celulaDeContrato(contrato.get(nome))} | ${mostrados}${resto} |`)
  }
  return linhas.join('\n')
}

export function gerarTabela(raiz = RAIZ) {
  return tabelaDeEnvs(varrerEnvs(raiz), varrerPadroes(raiz), lerContrato(raiz))
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
  writeFileSync(caminho, reescreverApendice(doc, gerarTabela()))
  process.stdout.write(`OPERACAO.md: apendice de envs regravado com ${varrerEnvs().size} variaveis\n`)
}

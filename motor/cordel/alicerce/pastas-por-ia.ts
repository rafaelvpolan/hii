// Pastas por IA no projeto-alvo: `.hii/` e a fonte neutra (regras, memoria, contrato)
// e cada IA tem a sua pasta em `.hii/ia/<ia>/` com papeis (agents) e skills. A
// projecao leva o conteudo para o padrao nativo de cada IA, sem sobrescrever o que
// um humano escreveu. Este arquivo cobre claude e ollama; codex projeta o seu.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const IAS_COM_PASTA = ['claude', 'codex', 'ollama'] as const
export type IaComPasta = (typeof IAS_COM_PASTA)[number]

const INICIO = '<!-- hii:inicio — gerado por `hii projetar`; edite .hii/rules.md, nao este bloco -->'
const FIM = '<!-- hii:fim -->'

export function pastaDaIa(alvo: string, ia: string): string {
  return join(alvo, '.hii', 'ia', ia.replace(/-ollama$/, ''))
}

const LEIA_ME: Record<IaComPasta, string> = {
  codex: `# Pasta do Codex neste projeto

- agents/: papeis que o motor injeta no prompt; nao presumem subagentes nativos.
- skills/<nome>/SKILL.md: skills projetadas para .agents/skills.
- executions/: artefatos transitorios separados por IA; nao guardar credenciais.
- A memoria duravel compartilhada fica em .hii/memory.

\`hii projetar <repo> codex\` atualiza o bloco gerenciado de AGENTS.md e preserva instrucoes humanas.
`,

  claude: `# Pasta do Claude neste projeto

- agents/: papeis no formato do Claude Code (frontmatter name, description, tools). Vencem o catalogo do motor quando o nome coincide.
- skills/<nome>/SKILL.md: skills no formato do Claude Code.

\`hii projetar <repo> claude\` copia para .claude/agents e .claude/skills e grava o bloco gerenciado do CLAUDE.md a partir de .hii/rules.md.
`,
  ollama: `# Pasta do Ollama neste projeto

- agents/: papeis em markdown com frontmatter (name, description). O Ollama nao tem subagentes nativos: o motor injeta o papel como texto no prompt do laco agentico.
- skills/: instrucoes extras por papel, lidas pelo motor; o Ollama nao tem descoberta nativa de skills.
`,
}

export function diretoriosPorIa(home: string): string[] {
  return IAS_COM_PASTA.flatMap(ia => [join(home, 'ia', ia, 'agents'), join(home, 'ia', ia, 'skills'), join(home, 'ia', ia, 'executions')])
}

export function leiaMePorIa(home: string): Array<[string, string]> {
  return IAS_COM_PASTA.map(ia => [join(home, 'ia', ia, 'LEIA-ME.md'), LEIA_ME[ia]] as [string, string])
}

export function blocoGerenciado(regras: string): string {
  return [
    INICIO,
    '## Regras do projeto (fonte: .hii/rules.md)',
    '',
    regras.trim(),
    '',
    '## Memoria do projeto',
    '',
    'Leia .hii/memory/ antes de mudar convencoes, e registre ali as decisoes duraveis.',
    FIM,
  ].join('\n')
}

export function comBlocoGerenciado(atual: string, bloco: string): string {
  const i = atual.indexOf(INICIO.slice(0, 16))
  const f = atual.indexOf(FIM)
  if (i >= 0 && f > i) return atual.slice(0, i) + bloco + atual.slice(f + FIM.length)
  return atual.trim() ? `${atual.replace(/\s*$/, '')}\n\n${bloco}\n` : `${bloco}\n`
}

function arquivosDe(dir: string): string[] {
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return []
  return readdirSync(dir).flatMap(nome => {
    const caminho = join(dir, nome)
    const info = lstatSync(caminho)
    if (info.isSymbolicLink()) return []
    return info.isDirectory() ? arquivosDe(caminho) : [caminho]
  })
}

export interface RelatorioDeProjecao {
  readonly escritos: string[]
  readonly iguais: string[]
  readonly preservados: string[]
}

function hashDeArquivo(caminho: string): string {
  return createHash('sha256').update(readFileSync(caminho)).digest('hex')
}

export function temLinkNoDestino(alvo: string, caminho: string): boolean {
  let atual = resolve(caminho)
  const raiz = resolve(alvo)
  while (atual !== raiz) {
    try { if (lstatSync(atual).isSymbolicLink()) return true }
    catch (e) { if ((e as { code?: string }).code !== 'ENOENT') throw e }
    const pai = dirname(atual)
    if (pai === atual) return true
    atual = pai
  }
  return false
}

function copiarSemSobrescrever(origem: string, destino: string, r: { escritos: string[]; iguais: string[]; preservados: string[] }, projeto: string): void {
  const manifesto = join(projeto, '.hii', 'state', 'projecao.json')
  if (temLinkNoDestino(projeto, manifesto)) throw new Error('manifesto de projecao nao pode ser link simbolico')
  const gerenciados: Record<string, string> = existsSync(manifesto) ? JSON.parse(readFileSync(manifesto, 'utf8')) as Record<string, string> : {}
  for (const arquivo of arquivosDe(origem)) {
    if (arquivo.endsWith('LEIA-ME.md')) continue
    const alvo = join(destino, relative(origem, arquivo))
    const chave = relative(projeto, alvo)
    if (temLinkNoDestino(projeto, alvo)) { r.preservados.push(alvo); continue }
    const fonteHash = hashDeArquivo(arquivo)
    const existe = existsSync(alvo)
    const atualHash = existe ? hashDeArquivo(alvo) : ''
    if (atualHash === fonteHash) { r.iguais.push(alvo); continue }
    if (!existe || (gerenciados[chave] && atualHash === gerenciados[chave])) {
      mkdirSync(dirname(alvo), { recursive: true })
      copyFileSync(arquivo, alvo)
      gerenciados[chave] = fonteHash
      r.escritos.push(alvo)
    } else {
      r.preservados.push(alvo)
    }
  }
  mkdirSync(dirname(manifesto), { recursive: true })
  const novo = JSON.stringify(gerenciados, null, 2) + '\n'
  if (!existsSync(manifesto) || readFileSync(manifesto, 'utf8') !== novo) writeFileSync(manifesto, novo)
}

export function projetarParaClaude(alvo: string): RelatorioDeProjecao {
  const r = { escritos: [] as string[], iguais: [] as string[], preservados: [] as string[] }
  const regras = existsSync(join(alvo, '.hii', 'rules.md')) ? readFileSync(join(alvo, '.hii', 'rules.md'), 'utf8') : ''
  const claudeMd = join(alvo, 'CLAUDE.md')
  if (temLinkNoDestino(alvo, claudeMd)) throw new Error('CLAUDE.md nao pode ser link simbolico na projecao')
  const atual = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : ''
  const novo = comBlocoGerenciado(atual, blocoGerenciado(regras))
  if (novo === atual) r.iguais.push(claudeMd)
  else { writeFileSync(claudeMd, novo); r.escritos.push(claudeMd) }
  const pasta = pastaDaIa(alvo, 'claude')
  copiarSemSobrescrever(join(pasta, 'agents'), join(alvo, '.claude', 'agents'), r, alvo)
  copiarSemSobrescrever(join(pasta, 'skills'), join(alvo, '.claude', 'skills'), r, alvo)
  return r
}

export function projetarParaCodex(alvo: string): RelatorioDeProjecao {
  const r = { escritos: [] as string[], iguais: [] as string[], preservados: [] as string[] }
  const fonte = join(alvo, '.hii', 'rules.md')
  const regras = existsSync(fonte) ? readFileSync(fonte, 'utf8') : ''
  const arquivo = join(alvo, 'AGENTS.md')
  if (temLinkNoDestino(alvo, arquivo)) throw new Error('AGENTS.md nao pode ser link simbolico na projecao')
  const atual = existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : ''
  const novo = comBlocoGerenciado(atual, blocoGerenciado(regras))
  if (novo === atual) r.iguais.push(arquivo)
  else { writeFileSync(arquivo, novo); r.escritos.push(arquivo) }
  copiarSemSobrescrever(join(pastaDaIa(alvo, 'codex'), 'skills'), join(alvo, '.agents', 'skills'), r, alvo)
  return r
}

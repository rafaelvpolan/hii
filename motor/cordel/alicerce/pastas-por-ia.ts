// Pastas por IA no projeto-alvo: `.hii/` e a fonte neutra (regras, memoria, contrato)
// e cada IA tem a sua pasta em `.hii/ia/<ia>/` com papeis (agents) e skills. A
// projecao leva o conteudo para o padrao nativo de cada IA, sem sobrescrever o que
// um humano escreveu. Este arquivo cobre claude e ollama; codex projeta o seu.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const IAS_COM_PASTA = ['claude', 'ollama'] as const
export type IaComPasta = (typeof IAS_COM_PASTA)[number]

const INICIO = '<!-- hii:inicio — gerado por `hii projetar`; edite .hii/rules.md, nao este bloco -->'
const FIM = '<!-- hii:fim -->'

export function pastaDaIa(alvo: string, ia: string): string {
  return join(alvo, '.hii', 'ia', ia)
}

const LEIA_ME: Record<IaComPasta, string> = {
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
  return IAS_COM_PASTA.flatMap(ia => [join(home, 'ia', ia, 'agents'), join(home, 'ia', ia, 'skills')])
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
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(nome => {
    const caminho = join(dir, nome)
    return statSync(caminho).isDirectory() ? arquivosDe(caminho) : [caminho]
  })
}

export interface RelatorioDeProjecao {
  readonly escritos: string[]
  readonly iguais: string[]
  readonly preservados: string[]
}

function copiarSemSobrescrever(origem: string, destino: string, r: { escritos: string[]; iguais: string[]; preservados: string[] }): void {
  for (const arquivo of arquivosDe(origem)) {
    if (arquivo.endsWith('LEIA-ME.md')) continue
    const alvo = join(destino, relative(origem, arquivo))
    if (!existsSync(alvo)) {
      mkdirSync(dirname(alvo), { recursive: true })
      copyFileSync(arquivo, alvo)
      r.escritos.push(alvo)
    } else if (readFileSync(alvo, 'utf8') === readFileSync(arquivo, 'utf8')) {
      r.iguais.push(alvo)
    } else {
      r.preservados.push(alvo)
    }
  }
}

export function projetarParaClaude(alvo: string): RelatorioDeProjecao {
  const r = { escritos: [] as string[], iguais: [] as string[], preservados: [] as string[] }
  const regras = existsSync(join(alvo, '.hii', 'rules.md')) ? readFileSync(join(alvo, '.hii', 'rules.md'), 'utf8') : ''
  const claudeMd = join(alvo, 'CLAUDE.md')
  const atual = existsSync(claudeMd) ? readFileSync(claudeMd, 'utf8') : ''
  const novo = comBlocoGerenciado(atual, blocoGerenciado(regras))
  if (novo === atual) r.iguais.push(claudeMd)
  else { writeFileSync(claudeMd, novo); r.escritos.push(claudeMd) }
  const pasta = pastaDaIa(alvo, 'claude')
  copiarSemSobrescrever(join(pasta, 'agents'), join(alvo, '.claude', 'agents'), r)
  copiarSemSobrescrever(join(pasta, 'skills'), join(alvo, '.claude', 'skills'), r)
  return r
}

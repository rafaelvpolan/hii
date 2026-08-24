import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { diretorioDeSkills } from '../../cdl/ali/config'

// VTB — a configuracao do proprio agente como superficie de ataque.
//
// Todo gate deste motor olha o codigo que a IA produz. Nenhum olhava o que a IA
// LE: SKILL.md, mcp.json e hooks entram no prompt de um papel que roda com Bash
// e Write no worktree. Skill vinda de catalogo externo (_sources/) e conteudo
// de terceiro com acesso de escrita indireto.
//
// Grep deterministico de proposito, sem modelo nenhum: pedir a uma IA que
// julgue se um texto e injecao contra ela mesma e exatamente o autorrelato que
// este motor nao aceita em gate nenhum.
//
// O risco de um gate assim nao e deixar passar, e acusar demais: um checklist
// que reprova todo texto de seguranca vira ruido e e desligado na primeira
// semana. Por isso os padroes casam INSTRUCAO IMPERATIVA ao agente, nunca
// mencao de assunto — e ha teste provando que o acervo real passa limpo.

export interface PadraoDeRisco {
  readonly id: string
  readonly rx: RegExp
  readonly porque: string
}

export const PADROES_DE_RISCO: readonly PadraoDeRisco[] = [
  {
    id: 'ignora-instrucao-anterior',
    rx: /\b(?:ignore|ignorar|desconsidere|esque[cç]a)\b[^.\n]{0,40}\b(?:instru[cç][oõ]es?|regras?|tudo|all previous|previous instructions?)\b/i,
    porque: 'manda o agente descartar as regras que o motor injetou antes — porta de entrada classica de prompt injection',
  },
  {
    id: 'pula-gate',
    rx: /\b(?:pul(?:e|ar)|skip|ignor(?:e|ar))\b[^.\n]{0,30}\b(?:gate|teste|tests?|revis[aã]o|review|valida[cç][aã]o)\b/i,
    porque: 'instrui a saltar um portao de qualidade — o gate so vale se nao puder ser dispensado por texto',
  },
  {
    id: 'desliga-rigor',
    rx: /HICODE_\w+\s*=\s*(?:0|off|false)/i,
    porque: 'desliga por instrucao um interruptor de rigor do proprio motor',
  },
  {
    id: 'commit-sem-verificacao',
    rx: /--no-verify\b/,
    porque: 'contorna os hooks de pre-commit/pre-push do alvo',
  },
  {
    id: 'escalada-de-permissao',
    rx: /--dangerously[\w-]*|\bsudo\s+chmod\b|\bchmod\s+777\b|--allowedTools\b|acceptEdits/i,
    porque: 'pede privilegio alem do minimo necessario para a tarefa',
  },
  {
    id: 'busca-e-executa',
    rx: /\b(?:curl|wget)\b[^|\n]{0,120}\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    porque: 'baixa e executa codigo de fora do repositorio, sem revisao',
  },
  {
    id: 'troca-de-papel',
    rx: /\b(?:you are now|voc[eê] agora [eé]|a partir de agora voc[eê] [eé]|act as if)\b/i,
    porque: 'redefine o papel do agente por dentro do conteudo, contornando o loadout que o motor escolheu',
  },
  {
    id: 'exfiltracao-de-segredo',
    rx: /\b(?:cat|print|envie|send|post)\b[^.\n]{0,40}(?:~\/\.ssh|\.env\b|id_rsa|credentials)/i,
    porque: 'manda ler ou mandar embora material sensivel do host',
  },
]

export interface AchadoDeHarness {
  readonly arquivo: string
  readonly linha: number
  readonly padrao: string
  readonly porque: string
  readonly trecho: string
}

export function auditarTexto(texto: string, arquivo: string): AchadoDeHarness[] {
  const achados: AchadoDeHarness[] = []
  const linhas = texto.split('\n')
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? ''
    for (const p of PADROES_DE_RISCO) {
      if (p.rx.test(linha)) {
        achados.push({ arquivo, linha: i + 1, padrao: p.id, porque: p.porque, trecho: linha.trim().slice(0, 160) })
      }
    }
  }
  return achados
}

function varrer(raiz: string, aceita: (nome: string) => boolean): string[] {
  if (!existsSync(raiz)) return []
  const fora: string[] = []
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) fora.push(...varrer(caminho, aceita))
    else if (aceita(nome)) fora.push(caminho)
  }
  return fora
}

export function arquivosAuditados(raizSkills: string = diretorioDeSkills()): string[] {
  return varrer(raizSkills, nome => nome === 'SKILL.md' || nome === 'mcp.json').sort()
}

export function auditarHarness(raizSkills: string = diretorioDeSkills()): AchadoDeHarness[] {
  return arquivosAuditados(raizSkills).flatMap(arquivo => {
    try {
      return auditarTexto(readFileSync(arquivo, 'utf8'), arquivo)
    } catch {
      return [{ arquivo, linha: 0, padrao: 'ilegivel', porque: 'nao consegui ler o arquivo para auditar', trecho: '' }]
    }
  })
}

export function relatoDaAuditoria(achados: readonly AchadoDeHarness[]): string {
  if (!achados.length) return `auditoria do harness: nenhum achado em ${PADROES_DE_RISCO.length} padroes de risco`
  return [
    `auditoria do harness: ${achados.length} achado(s) — skill nova nao entra em producao assim:`,
    ...achados.map(a => `- ${a.arquivo}:${a.linha} [${a.padrao}] ${a.porque} — "${a.trecho}"`),
  ].join('\n')
}

import { anexarEvento, eventosDoCard } from '../../euclides/eventos.ts'
import type { StepProfile } from '../../oswaldo/rota/perfil.ts'

// Chagas — Carlos Chagas: descreveu vetor, parasita e doenca. Prova de ciclo
// completo, nao "um teste qualquer que passa".
//
// Item 5: no perfil `completo`, o teste tem de ter FALHADO antes de passar. Um
// teste escrito depois do codigo, que ja nasce verde, nao prova que cobre o
// caminho — prova so que compila. A evidencia do RED fica no diario do card,
// nao no relato do modelo: "o modelo disse que fez TDD" e exatamente o tipo de
// autorrelato que nenhum gate deste motor aceita.

export const FASE_RED = 'red'

// De ONDE veio a evidencia. Registrar isto e o que impede relato de agente de se
// passar por observacao do motor — as duas coisas valem, mas nao valem o mesmo, e
// quem le o card tem de conseguir distinguir sem ir ao codigo.
export type OrigemDoRed = 'motor' | 'agente'

const MARCA_DE_ORIGEM: Record<OrigemDoRed, string> = {
  motor: 'motor observou',
  agente: 'agente anexou saida',
}

// `motor`: o comando de teste reprovou na primeira rodada do fecho — o motor VIU.
// `agente`: o passo de testes anexou a saida vermelha do comando antes de
// implementar, e o motor validou o que da para validar naquele texto.
export function registrarRed(card: string, detalhe: string, origem: OrigemDoRed = 'motor'): void {
  anexarEvento({ card, evento: 'gate_verdict', fase: FASE_RED, detalhe: `[${MARCA_DE_ORIGEM[origem]}] ${detalhe}` })
}

export function origemDoDetalhe(detalhe: string): OrigemDoRed | '' {
  for (const [origem, marca] of Object.entries(MARCA_DE_ORIGEM)) {
    if (detalhe.startsWith(`[${marca}]`)) return origem as OrigemDoRed
  }
  return ''
}

export const ABRE_RED = '<<<RED>>>'
export const FECHA_RED = '<<<FIM RED>>>'

// Sinais de que o texto anexado e SAIDA DE FALHA e nao uma frase dizendo que
// houve falha. Nao provam execucao — nada num texto prova — mas barram o caso
// barato: colar "rodei e falhou" e seguir em frente.
const SINAL_DE_FALHA = /\b(?:fail(?:ed|ing|s|ures?)?|erro?r?s?|assertion|reprov\w*|not ok|✗|✖|FAIL)\b/i
// VERDE EXPLICITO vence, e vem primeiro. Relatorio de suite verde CONTEM a palavra
// "fail" — em "0 fail" — entao procurar sinal de falha antes aceitaria a suite
// inteira passando como se fosse evidencia de RED. Era o buraco que tornaria a
// exigencia um carimbo.
// As tres ordens em que os runners escrevem a contagem: "0 fail" (bun),
// "failed: 0" (jest/vitest) e "fail 0" (node:test). Faltando qualquer uma, a saida
// verde daquele runner passaria como evidencia de RED.
const VERDE_EXPLICITO = /\b0\s+fail\w*\b|\bfail(?:ed|ures?)?\s*[:=]?\s*0\b|\ball tests? passed\b|\bnenhuma falha\b|\bno tests? failed\b/i
// Duas linhas OU 40 caracteres. So o tamanho recusava saida legitima e concisa —
// o sumario do `node --test` cabe em "ℹ fail 4 / ℹ pass 48". O que se quer barrar e
// a FRASE solta ("falhou"), que tem uma linha e e curta.
const MINIMO_DE_TEXTO = 40
const MINIMO_DE_LINHAS = 2

export interface RelatoDeRed {
  readonly aceito: boolean
  readonly saida: string
  readonly motivo: string
}

// Le o bloco marcado no relato do agente e decide se ele conta como evidencia.
// O que o motor CONSEGUE conferir: que o bloco existe, que tem corpo, que parece
// saida de falha, e que nao e um relatorio VERDE colado por engano (ou de proposito).
// O que ele nao consegue: saber se o comando rodou mesmo. Por isso a evidencia fica
// marcada como `agente` e nao se confunde com a que o motor observou.
export function lerRelatoDeRed(texto: string): RelatoDeRed {
  const t = String(texto ?? '')
  const i = t.indexOf(ABRE_RED)
  if (i < 0) return { aceito: false, saida: '', motivo: `o passo de testes nao anexou o bloco ${ABRE_RED}` }
  const j = t.indexOf(FECHA_RED, i + ABRE_RED.length)
  const bruto = (j < 0 ? t.slice(i + ABRE_RED.length) : t.slice(i + ABRE_RED.length, j)).trim()
  const linhas = bruto.split('\n').filter(l => l.trim().length > 0).length
  if (bruto.length < MINIMO_DE_TEXTO && linhas < MINIMO_DE_LINHAS) {
    return { aceito: false, saida: bruto, motivo: `bloco de RED vazio ou curto demais (${bruto.length} caracteres, ${linhas} linha(s)) — cole a saida do comando, nao uma frase` }
  }
  if (VERDE_EXPLICITO.test(bruto)) {
    return { aceito: false, saida: bruto, motivo: 'a saida anexada e de suite VERDE (contagem de falhas zero) — RED e o teste reprovando ANTES da implementacao' }
  }
  if (!SINAL_DE_FALHA.test(bruto)) {
    return { aceito: false, saida: bruto, motivo: 'a saida anexada nao tem nenhum sinal de falha — nao parece saida de teste reprovando' }
  }
  return { aceito: true, saida: bruto, motivo: 'saida com sinal de falha anexada pelo passo de testes' }
}

// Instrucao acrescentada ao passo de testes no perfil `completo`. Fica aqui, junto
// do leitor, para o formato exigido e o formato lido nao poderem divergir.
export function instrucaoDeRed(comando: string): string {
  return [
    '',
    'EVIDENCIA DE RED (obrigatoria neste perfil, o motor CONFERE):',
    '1. Escreva o teste ANTES da implementacao.',
    `2. Rode o comando de teste do projeto (${comando || 'o comando configurado no alvo'}) e confirme que ele REPROVA.`,
    `3. Cole a saida REAL do comando, com a falha, entre ${ABRE_RED} e ${FECHA_RED}.`,
    '4. So depois implemente ate o teste passar.',
    '',
    'Sem esse bloco o passo e recusado. Nao descreva a falha: cole a saida.',
  ].join('\n')
}

export interface EvidenciaDeRed {
  readonly temRed: boolean
  readonly quando: string
  readonly detalhe: string
}

// Registrado por quem roda o teste, quando ele reprova ANTES da implementacao.
export function evidenciaDeRed(card: string): EvidenciaDeRed {
  const red = eventosDoCard(card).find(e => e.evento === 'gate_verdict' && e.fase === FASE_RED)
  return { temRed: !!red, quando: red?.ts ?? '', detalhe: red?.detalhe ?? '' }
}

export interface ExigenciaDeRed {
  readonly exigido: boolean
  readonly satisfeito: boolean
  readonly motivo: string
}

// So o perfil `completo` exige. Nos outros o custo de forcar RED nao paga: um
// ajuste de texto nao tem caminho de erro para provar primeiro.
export function exigirRedAntesDoGreen(card: string, perfil: StepProfile): ExigenciaDeRed {
  if (perfil !== 'completo') {
    return { exigido: false, satisfeito: true, motivo: `perfil "${perfil}" nao exige RED antes do GREEN` }
  }
  const ev = evidenciaDeRed(card)
  if (ev.temRed) {
    return { exigido: true, satisfeito: true, motivo: `RED registrado em ${ev.quando}: ${ev.detalhe}` }
  }
  return {
    exigido: true,
    satisfeito: false,
    motivo: 'perfil completo exige teste que FALHOU antes de passar, e o diario do card nao tem evento de RED — teste escrito depois do codigo nao prova cobertura',
  }
}

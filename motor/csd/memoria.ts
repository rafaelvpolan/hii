import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../cdl/index.ts'

// CSD — memoria do projeto: decisoes e convencoes acumuladas entre cards,
// injetada no prompt do implementador (motor/cic/agente.ts).
//
// O teto existe porque isto entra em TODA chamada de implementacao: sem limite,
// o custo de entrada cresce para sempre. Mas o recorte tem de ser pelo COMECO,
// nunca pelo fim — cortar o fim mantinha os caracteres mais antigos e descartava
// os novos, entao a memoria congelava no passado e nada do que o motor
// aprendesse depois chegava ao prompt. E cortava calado, que e o pior dos dois:
// degradacao invisivel e o modo de falha que este motor recusa em todo lugar.

export const TETO_DA_MEMORIA = 2500

function memDir(target: string): string {
  return join(target, '.hii', 'memory')
}

function recortarMantendoORecente(texto: string): string {
  if (texto.length <= TETO_DA_MEMORIA) return texto
  const omitidos = texto.length - TETO_DA_MEMORIA
  const cauda = texto.slice(omitidos)
  const quebra = cauda.indexOf('\n')
  const inteiro = quebra >= 0 ? cauda.slice(quebra + 1) : cauda
  return `(memoria truncada: ${omitidos} caracteres mais antigos omitidos)\n${inteiro}`
}

export function readProjectMemory(target: string): string {
  const dir = memDir(target)
  if (!existsSync(dir)) return ''
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.md')).sort()
    const parts: string[] = []
    for (const f of files) {
      try { parts.push(readFileSync(join(dir, f), 'utf8').trim()) } catch { void 0 }
    }
    return recortarMantendoORecente(parts.filter(Boolean).join('\n\n'))
  } catch {
    return ''
  }
}

export function appendProjectMemory(target: string, line: string): void {
  const dir = memDir(target)
  const file = join(dir, 'motor.md')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(file)) {
      try { writeFileSync(file, '# Memoria do motor (acumulada por card — decisoes e o que foi construido)\n\n', { flag: 'wx' }) } catch { void 0 }
    }
    appendFileSync(file, `- ${isoNow()} ${line.replace(/\s+/g, ' ').slice(0, 200)}\n`)
  } catch {
    void 0
  }
}

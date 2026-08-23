import { laravelPhp } from './laravel-php'
import type { ReparadorDeBuild } from './tipos'

export type { ReparadorDeBuild } from './tipos'

// Um arquivo novo por dominio, uma linha aqui. Ordem importa: o primeiro que
// detectar vence, entao dominios mais especificos vem antes dos genericos.
const REPARADORES: readonly ReparadorDeBuild[] = [
  laravelPhp,
]

export function reparadoresRegistrados(): readonly ReparadorDeBuild[] {
  return REPARADORES
}

// null = nenhum dominio reconhecido; o portao generico de build assume.
// Devolver um reparador "de mentira" seria pior que nao ter: a instrucao
// estreita viraria chute com cara de diagnostico.
export function escolherReparador(arquivos: readonly string[]): ReparadorDeBuild | null {
  return REPARADORES.find(r => r.detecta(arquivos)) ?? null
}

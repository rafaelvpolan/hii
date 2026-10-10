import type { EventoDoHarness } from '../tomada/tipos.ts'

export interface SaudeDaTrajetoria {
  estado: 'sem_evidencia' | 'observavel' | 'repeticao'
  recomendacao: 'observar' | 'advisory'
  ferramentasConcluidas: number
  repeticoes: number
  proximaInspecaoMs: number
}

// Mesmo nome de ferramenta nao prova loop: nao observamos argumentos,
// resultados nem progresso dos testes. Por isso nunca cancela a chamada.
export function monitorDeTrajetoria(): { evento(e: EventoDoHarness): void; inspecionar(): SaudeDaTrajetoria } {
  let ultima = ''
  let repeticoes = 0
  let ferramentasConcluidas = 0
  return {
    evento(e) {
      if (e.tipo !== 'ferramenta_fim') return
      ferramentasConcluidas++
      repeticoes = e.ferramenta === ultima ? repeticoes + 1 : 1
      ultima = e.ferramenta
    },
    inspecionar() {
      const suspeita = repeticoes >= 6
      return { estado: !ferramentasConcluidas ? 'sem_evidencia' : suspeita ? 'repeticao' : 'observavel',
        recomendacao: suspeita ? 'advisory' : 'observar', ferramentasConcluidas, repeticoes,
        proximaInspecaoMs: suspeita ? 5000 : ferramentasConcluidas ? 30000 : 15000 }
    },
  }
}

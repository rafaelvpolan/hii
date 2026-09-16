import type { Atividade, Evento, Snapshot } from './contrato.ts'

/** Usada por terminais e conectores: apenas projecao, nunca regras de negocio. */
export class Projecao {
  readonly atividades = new Map<string, Atividade>()
  cursor = ''
  degradado = false
  reconstruir(s: Snapshot): void {
    this.atividades.clear()
    for (const a of s.atividades) this.atividades.set(a.id, a)
    this.cursor = s.cursor
    this.degradado = s.degradado
  }
  aplicar(e: Evento): void {
    if (e.versao !== 1) throw new Error('versao de observabilidade nao suportada')
    const anterior = this.atividades.get(e.atividade.id)
    if (anterior && anterior.revisao >= e.atividade.revisao) return
    const saida = new Map((anterior?.saida ?? []).map(s => [s.sequencia, s]))
    for (const s of e.atividade.saida) saida.set(s.sequencia, s)
    const retida = [...saida.values()].sort((a, b) => a.sequencia - b.sequencia).slice(-64)
    while (retida.reduce((n, s) => n + s.texto.length, 0) > 16384) retida.shift()
    this.atividades.set(e.atividade.id, { ...e.atividade, saida: retida })
    this.cursor = e.id
  }
}

export function resumoAtivo(atividades: readonly Atividade[], agora = Date.now()): string[] {
  return atividades.filter(a => !a.fim).map(a => {
    const idade = Math.max(0, Math.floor((agora - Date.parse(a.atualizado)) / 1000))
    return `${a.recurso.nome}: ${a.estado} · ${a.etapa}${idade >= 60 ? ` · sem progresso ha ${idade}s` : ''}`
  })
}

// Pedido em uso: "preciso de uma confirmacao para tarefas desse tipo, perguntando
// se resolveu o problema? posso encerrar?".
//
// "Desse tipo" e a tarefa SEM URL (`verify: sem-url`): nela o humano nunca VIU a
// coisa funcionando. Na tarefa visual ele ja olhou a url e aprovou, e uma segunda
// pergunta no fim so atrasaria.
//
// POR QUE ANTES DO PUSH/PR, E NAO DEPOIS. O fecho apaga o worktree ao abrir o PR, e
// `ensureWorktree` recria a branch com `worktree add -B ... origin/base` — ou seja,
// DESCARTA os commits do card. Perguntar depois do PR faria o "nao resolveu" jogar
// fora o trabalho. Perguntando aqui, o worktree esta vivo e a correcao e barata.
//
// O "sim" nao repete passo nenhum: o card volta com `resume_from` no sentinela de
// pos-passos, e `resumeStart` pula todos.
import type { Fields } from '../../cdl/index.ts'

export const CONFIRMADO = 'sim'

export function precisaConfirmarFecho(fm: Fields): boolean {
  return String(fm.verify ?? '') === 'sem-url' && String(fm.fecho_confirmado ?? '') !== CONFIRMADO
}

function duracaoCurta(segundos: number): string {
  if (segundos <= 0) return '—'
  if (segundos < 60) return `${segundos}s`
  const m = Math.floor(segundos / 60)
  if (m < 60) return `${m}m${String(segundos % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export function perguntaDeFecho(fm: Fields, passosRodados?: readonly string[]): string {
  const tempo = duracaoCurta(Number(fm.tempo_s ?? '0') || 0)
  const custo = String(fm.cost_usd ?? '0')
  const rodou = passosRodados ? ` · rodou [${passosRodados.length ? passosRodados.join(', ') : 'nenhum passo de polimento'}]` : ''
  return `resolveu o problema? posso encerrar? — motor ${tempo} · US$${custo}${rodou}`
    + ' · responda 1 para encerrar e abrir o PR, ou diga o que ainda falta'
}

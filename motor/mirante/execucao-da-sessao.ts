import { readCard } from '../cordel/store.ts'
import { criarSessaoHii, lerSessaoHii, registrarMensagem, vincularExecucao } from '../euclides/sessoes.ts'
import type { ModoDoMotor } from '../oswaldo/orquestracao/config.ts'
import { submitSession } from './acoes.ts'

export function sessaoDaTarefa(id: string): string {
  if (!id) return ''
  const fm = readCard(id)?.fm
  return fm?.tipo === 'session' ? id : fm?.sessao_id ?? ''
}

export function prepararExecucao(repo: string, seguindo: string, titulo: string, modo: ModoDoMotor = 'gateway'): { sessao_id: string; motor_modo: ModoDoMotor; pipeline: string } {
  let sessao = sessaoDaTarefa(seguindo)
  if (sessao) {
    const pai = readCard(sessao)
    if (pai?.fm.repo !== repo) sessao = ''
    else criarSessaoHii(sessao, repo, pai.fm.title ?? titulo)
  }
  if (!sessao) sessao = submitSession({ title: titulo, repo })
  if (lerSessaoHii(sessao)?.estado !== 'aberta') throw new Error('session fechada; abra outra com /new')
  return { sessao_id: sessao, motor_modo: modo, pipeline: modo === 'passivo' ? 'auto' : 'manual' }
}

export function registrarPedido(sessao: string, id: string, modo: ModoDoMotor, texto: string): void {
  vincularExecucao(sessao, id, modo)
  registrarMensagem(sessao, { autor: 'humano', texto, execucao: id, provedor: '', modelo: '' }, `pedido-${id}`)
}

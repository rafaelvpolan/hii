import { test, expect } from '../apoio/runner.ts'
import { createApp } from '../../motor/mirante/tui/app.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'

function terminal(): Terminal & { tecla: (s: string) => void; saida: string[] } {
  const saida: string[] = []
  let ler = (_s: string): void => {}
  return { saida, tecla: s => ler(s), write: s => { saida.push(s) }, rows: () => 24, cols: () => 80,
    setRaw: () => {}, onKey: f => { ler = f }, offKey: () => { ler = () => {} }, onResize: () => {}, offResize: () => {} }
}

function criar(t: Terminal, onLine: (s: string) => Promise<void> | void, corpo = () => [] as string[]) {
  return createApp(t, { header: () => 'hii', corpo, dica: () => '', prompt: () => '> ', rodape: () => [],
    onLine, onComplete: () => [], onInterrupt: () => true, intervalMs: 100000 })
}

test('apos encerrar, comandos ainda na fila nao executam nem consultam a tela', async () => {
  const t = terminal()
  let liberar = (): void => {}
  const bloqueio = new Promise<void>(r => { liberar = r })
  const enviados: string[] = []
  let pinturas = 0
  const a = criar(t, async s => { enviados.push(s); if (s === 'primeiro') await bloqueio }, () => { pinturas++; return [] })
  const fim = a.run()
  t.tecla('primeiro\rsegundo\r')
  await new Promise(r => setTimeout(r, 5))
  a.encerrar()
  const antes = pinturas
  liberar()
  await fim
  await new Promise(r => setTimeout(r, 10))
  expect(enviados).toEqual(['primeiro'])
  expect(pinturas).toBe(antes)
})

test('estado alterado no fim de onLine e pintado sem esperar o timer', async () => {
  const t = terminal()
  let estado = 'antes'
  const a = criar(t, async () => { await Promise.resolve(); estado = 'depois' }, () => [estado])
  const fim = a.run()
  try {
    t.tecla('mudar\r')
    await new Promise(r => setTimeout(r, 10))
    expect(telaVirtual(t.saida)).toContain('depois')
    expect(telaVirtual(t.saida)).not.toContain('antes')
  } finally { a.encerrar(); await fim }
})

test('falha de comando aparece e a proxima entrada continua funcionando', async () => {
  const t = terminal()
  const a = criar(t, s => { if (s === 'falhar') throw new Error('falha controlada'); a.log('comando recuperado') })
  const fim = a.run()
  try {
    t.tecla('falhar\rseguir\r')
    await new Promise(r => setTimeout(r, 10))
    const tela = telaVirtual(t.saida)
    expect(tela).toContain('falha controlada')
    expect(tela).toContain('comando recuperado')
  } finally { a.encerrar(); await fim }
})

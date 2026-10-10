import { test, expect } from '../apoio/runner.ts'
import { monitorDeTrajetoria } from '../../motor/ciclo/trajetoria.ts'

test('harness sem eventos nao comprova saude ou progresso', () => {
  const monitor = monitorDeTrajetoria()
  monitor.evento({ tipo: 'inferencia_inicio' })
  expect(monitor.inspecionar().estado).toBe('sem_evidencia')
})

test('supervisao aumenta frequencia na repeticao mas nao confunde sinal com prova de loop', () => {
  const monitor = monitorDeTrajetoria()
  for (let i = 0; i < 6; i++) monitor.evento({ tipo: 'ferramenta_fim', ferramenta: 'read' })
  expect(monitor.inspecionar().estado).toBe('repeticao')
  expect(monitor.inspecionar().recomendacao).toBe('advisory')
  expect(monitor.inspecionar().proximaInspecaoMs).toBe(5000)
  monitor.evento({ tipo: 'ferramenta_inicio', ferramenta: 'write' })
  expect(monitor.inspecionar().repeticoes).toBe(6)
  monitor.evento({ tipo: 'ferramenta_fim', ferramenta: 'write' })
  expect(monitor.inspecionar().estado).toBe('observavel')
  expect(monitor.inspecionar().proximaInspecaoMs).toBe(30000)
})

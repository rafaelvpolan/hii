import { test, expect } from '../apoio/runner.ts'
import { corpoGerenciado, sincronizarPr } from '../../motor/quilombo/cartorio/sincronizar-pr.ts'

const pedido = { card: '001', repoName: 'o/r', base: 'main', branch: 'hii/tarefa', titulo: 'tarefa', corpo: 'evidencia nova', worktree: '/tmp', prExistente: '' }

test('corpo gerenciado preserva notas humanas antes e depois e rejeita marcadores quebrados', () => {
  const atual = 'nota humana\n<!-- hii:inicio -->\nantigo\n<!-- hii:fim -->\nconclusao humana'
  const novo = corpoGerenciado(atual, 'novo')
  expect(novo).toContain('nota humana')
  expect(novo).toContain('conclusao humana')
  expect(novo).not.toContain('antigo')
  expect(corpoGerenciado(novo, 'novo')).toBe(novo)
  expect(() => corpoGerenciado('<!-- hii:inicio -->quebrado', 'novo')).toThrow('inconsistentes')
})

test('PR remoto e adotado apos crash; repetir atualizacao nao edita nem duplica', async () => {
  let corpo = 'nota humana'
  const chamadas: string[] = []
  const executar: Parameters<typeof sincronizarPr>[1] = async (_bin, args) => {
    chamadas.push(args[1] ?? '')
    if (args[1] === 'list') return { err: null, stdout: JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', body: corpo }]), stderr: '' }
    if (args[1] === 'edit') { corpo = args.at(-1) ?? ''; return { err: null, stdout: '', stderr: '' } }
    throw new Error('nao deve criar PR')
  }
  expect((await sincronizarPr(pedido, executar)).reaproveitada).toBe(true)
  expect((await sincronizarPr(pedido, executar)).url).toContain('/pull/7')
  expect(chamadas).toEqual(['list', 'edit', 'list'])
  expect(corpo).toContain('nota humana')
})

test('consulta invalida nao vira lista vazia e nao cria PR', async () => {
  let chamadas = 0
  const r = await sincronizarPr(pedido, async () => { chamadas++; return { err: null, stdout: 'quebrado', stderr: '' } })
  expect(r.url).toBe('')
  expect(r.erro).toContain('JSON invalido')
  expect(chamadas).toBe(1)
})

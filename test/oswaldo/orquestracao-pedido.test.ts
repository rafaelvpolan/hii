import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { rejects } from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lerPedidoOrquestrado } from '../../motor/oswaldo/orquestracao/pedido.ts'
import { extractObjetivo } from '../../motor/cordel/texto.ts'

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hii-spec-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

test('descricao continua descricao mesmo mencionando um arquivo spec', async () => {
  const texto = 'implemente conforme o contrato file.spec'
  expect((await lerPedidoOrquestrado(texto, dir)).descricao).toBe(texto)
})

test('spec relativo ao projeto, absoluto e com espacos preserva todas as secoes', async () => {
  const conteudo = '# Pedido\nimplemente a API\n## Criterios\npreserve contratos\n## Log de Estado\nultimo requisito\n'
  writeFileSync(join(dir, 'meu plano.spec'), conteudo)
  for (const caminho of ['"meu plano.spec"', "'meu plano.spec'", './meu plano.spec', join(dir, 'meu plano.spec')]) {
    const p = await lerPedidoOrquestrado(caminho, dir)
    expect(p.titulo).toBe('meu plano.spec')
    const objetivo = extractObjetivo(`## Objetivo\n${p.descricao}\n\n## Log de Estado\ncriado`)
    expect(objetivo).toContain('preserve contratos')
    expect(objetivo).toContain('ultimo requisito')
    expect(objetivo).not.toContain('criado')
  }
})

test('conteudo do spec e capturado no envio, sem depender de futuras edicoes do arquivo', async () => {
  writeFileSync(join(dir, 'tarefa.spec'), 'primeira versao')
  const p = await lerPedidoOrquestrado('tarefa.spec', dir)
  writeFileSync(join(dir, 'tarefa.spec'), 'outra versao')
  expect(p.descricao).toContain('primeira versao')
})

test('arquivo ausente ou diretorio nao vira tarefa com o nome do caminho', async () => {
  await rejects(lerPedidoOrquestrado('ausente.spec', dir), /abrir o spec/)
  mkdirSync(join(dir, 'pasta.spec'))
  await rejects(lerPedidoOrquestrado('pasta.spec', dir), /arquivo regular/)
})

test('spec vazio, binario e UTF-8 invalido sao recusados', async () => {
  for (const conteudo of [' \n', 'x\0y', Buffer.from([0xff, 0xfe])]) {
    writeFileSync(join(dir, 'invalido.spec'), conteudo)
    await rejects(lerPedidoOrquestrado('invalido.spec', dir))
  }
})

test('spec acima de 1 MiB e recusado sem truncamento', async () => {
  writeFileSync(join(dir, 'grande.spec'), 'x'.repeat(1024 * 1024 + 1))
  await rejects(lerPedidoOrquestrado('grande.spec', dir), /1 MiB/)
})

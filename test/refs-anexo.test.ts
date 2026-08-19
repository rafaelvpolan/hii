import { test, expect, beforeEach } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

let estado = ''
let fora = ''

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

beforeEach(() => {
  estado = mkdtempSync(join(tmpdir(), 'hii-refs-'))
  fora = mkdtempSync(join(tmpdir(), 'hii-fonte-'))
  process.env.HICODE_CARDS_DIR = estado
  delete process.env.HICODE_DISCO_TETO_MB
  delete process.env.HICODE_DISCO_ALERTA_MB
})

function imagemFora(nome: string, bytes = PNG): string {
  const caminho = join(fora, nome)
  writeFileSync(caminho, bytes)
  return caminho
}

test('url entra como fonte sem baixar nada na hora', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const { readRefSources } = await import('../lib/runner/refs')
  const a = anexarNaTarefa('010', 'https://exemplo.com/tela.png')
  expect(a.ok).toBe(true)
  expect(a.total).toBe(1)
  expect(a.copiado).toBe('')
  expect(readRefSources('010')).toEqual(['https://exemplo.com/tela.png'])
})

test('arquivo local e copiado para dentro do estado do motor', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const origem = imagemFora('print.png')
  const a = anexarNaTarefa('010', origem)
  expect(a.ok).toBe(true)
  expect(a.copiado).toContain(join(estado, 'refs', '010'))
  expect(existsSync(a.copiado)).toBe(true)
  expect(readFileSync(a.copiado)).toEqual(PNG)
  expect(existsSync(origem)).toBe(true)
})

test('INTEGRACAO: o que o /ref grava passa inteiro pelo resolveRefs, sem recusa', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const { resolveRefs, refPaths } = await import('../lib/runner/refs')
  anexarNaTarefa('010', imagemFora('um.png'))
  anexarNaTarefa('010', imagemFora('dois.jpg'))
  const saida = await resolveRefs('010')
  expect(saida.length).toBe(2)
  expect(saida.every(o => o.refusal === null)).toBe(true)
  expect(refPaths(saida).length).toBe(2)
})

test('recusa o que nao e imagem, o que nao existe e o que passa do teto de tamanho', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const { MAX_FILESIZE_BYTES } = await import('../lib/runner/download')
  const texto = join(fora, 'notas.txt')
  writeFileSync(texto, 'nao sou imagem')
  expect(anexarNaTarefa('010', texto).motivo).toContain('extensao de imagem')
  expect(anexarNaTarefa('010', join(fora, 'fantasma.png')).motivo).toContain('nao achei')
  const gigante = join(fora, 'gigante.png')
  writeFileSync(gigante, Buffer.concat([PNG, Buffer.alloc(MAX_FILESIZE_BYTES)]))
  expect(anexarNaTarefa('010', gigante).motivo).toContain('acima do teto')
})

test('o teto de 8 referencias por tarefa e respeitado', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const { MAX_REFS_POR_TAREFA } = await import('../lib/runner/estado-em-disco')
  for (let i = 0; i < MAX_REFS_POR_TAREFA; i++) {
    expect(anexarNaTarefa('010', `https://exemplo.com/${i}.png`).ok).toBe(true)
  }
  const cheio = anexarNaTarefa('010', 'https://exemplo.com/extra.png')
  expect(cheio.ok).toBe(false)
  expect(cheio.motivo).toContain(String(MAX_REFS_POR_TAREFA))
})

test('sem tarefa aberta a ref fica na sessao e migra para a tarefa depois', async () => {
  const { anexarNaSessao, fontesDaSessao, migrarRefsDaSessao } = await import('../lib/runner/refs-anexo')
  const { readRefSources } = await import('../lib/runner/refs')
  anexarNaSessao('s1', imagemFora('print.png'))
  anexarNaSessao('s1', 'https://exemplo.com/tela.png')
  expect(fontesDaSessao('s1').length).toBe(2)
  expect(readRefSources('010')).toEqual([])

  const m = migrarRefsDaSessao('s1', '010')
  expect(m.migrados).toBe(2)
  const fontes = readRefSources('010')
  expect(fontes.length).toBe(2)
  expect(fontes.some(f => f.includes(join('refs', '010')))).toBe(true)
  expect(fontes).toContain('https://exemplo.com/tela.png')
  expect(existsSync(join(estado, 'tmp', 'sessao', 's1'))).toBe(false)
})

test('migrar preserva as refs que a tarefa ja tinha', async () => {
  const { anexarNaSessao, anexarNaTarefa, migrarRefsDaSessao } = await import('../lib/runner/refs-anexo')
  anexarNaTarefa('010', 'https://exemplo.com/antiga.png')
  anexarNaSessao('s2', 'https://exemplo.com/nova.png')
  const m = migrarRefsDaSessao('s2', '010')
  expect(m.fontes).toEqual(['https://exemplo.com/antiga.png', 'https://exemplo.com/nova.png'])
})

test('duas refs locais nao colidem de nome, nem com o ref-N que o download usa', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  const a = anexarNaTarefa('010', imagemFora('a.png'))
  const b = anexarNaTarefa('010', imagemFora('b.png'))
  expect(basename(a.copiado)).not.toBe(basename(b.copiado))
  expect(basename(a.copiado).startsWith('local-')).toBe(true)
  expect(basename(b.copiado).startsWith('ref-')).toBe(false)
})

test('o uso de disco soma por area e acende alerta e teto', async () => {
  const { usoDeDisco, nivelDe } = await import('../lib/runner/estado-em-disco')
  mkdirSync(join(estado, 'refs', '010'), { recursive: true })
  writeFileSync(join(estado, 'refs', '010', 'local-1.png'), Buffer.alloc(2048))
  mkdirSync(join(estado, 'tmp', 'transito'), { recursive: true })
  writeFileSync(join(estado, 'tmp', 'transito', 'x.bruto'), Buffer.alloc(1024))
  const uso = usoDeDisco()
  expect(uso.bytes).toBe(3072)
  expect(uso.areas.find(a => a.area === 'refs')?.bytes).toBe(2048)
  expect(uso.areas.find(a => a.area === 'tmp')?.bytes).toBe(1024)
  expect(uso.nivel).toBe('ok')
  expect(nivelDe(3072, 2048, 8192)).toBe('alerta')
  expect(nivelDe(9000, 2048, 8192)).toBe('teto')
})

test('no teto de disco a ref e recusada em vez de encher o disco', async () => {
  const { anexarNaTarefa } = await import('../lib/runner/refs-anexo')
  mkdirSync(join(estado, 'refs', '009'), { recursive: true })
  writeFileSync(join(estado, 'refs', '009', 'gordo.png'), Buffer.alloc(2 * 1024 * 1024))
  process.env.HICODE_DISCO_TETO_MB = '1'
  const r = anexarNaTarefa('010', imagemFora('print.png'))
  expect(r.ok).toBe(false)
  expect(r.motivo).toContain('teto')
})

test('a limpeza de tmp remove o antigo e preserva a sessao em uso', async () => {
  const { limparTmpAntigo, dirDaSessao } = await import('../lib/runner/estado-em-disco')
  const velha = dirDaSessao('velha')
  const viva = dirDaSessao('viva')
  for (const d of [velha, viva]) {
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'local-1.png'), Buffer.alloc(512))
  }
  const antigo = new Date(Date.now() - 48 * 3600_000)
  utimesSync(velha, antigo, antigo)
  const r = limparTmpAntigo(24 * 3600_000, Date.now(), [viva])
  expect(r.removidos).toEqual([velha])
  expect(r.bytesLiberados).toBe(512)
  expect(existsSync(viva)).toBe(true)
  expect(existsSync(velha)).toBe(false)
})

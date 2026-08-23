import { test, expect, beforeEach } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DepsDeColagem, Rodada } from '../motor/mir/clipboard'

let estado = ''

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])

beforeEach(() => {
  estado = mkdtempSync(join(tmpdir(), 'hii-clip-'))
  process.env.HICODE_CARDS_DIR = estado
})

function rodada(over: Partial<Rodada> = {}): Rodada {
  return { ok: true, code: 0, stdout: Buffer.alloc(0), erro: '', ...over }
}

function deps(over: Partial<DepsDeColagem> = {}): DepsDeColagem {
  return {
    rodar: async () => rodada(),
    caminhoNativo: async (p) => `C:\\wsl${p}`,
    ambiente: () => 'wayland',
    ...over,
  }
}

test('o ambiente de clipboard e escolhido pela maquina, com WSL na frente', async () => {
  const { ambienteDeClipboard } = await import('../motor/mir/clipboard')
  const base = { plataforma: 'linux', temComando: () => true }
  expect(ambienteDeClipboard({ ...base, env: {}, procVersion: 'Linux version 6.18 microsoft-standard-WSL2' })).toBe('wsl')
  expect(ambienteDeClipboard({ ...base, env: { WSL_DISTRO_NAME: 'Ubuntu' }, procVersion: '' })).toBe('wsl')
  expect(ambienteDeClipboard({ ...base, env: { WAYLAND_DISPLAY: 'wayland-0' }, procVersion: 'Linux' })).toBe('wayland')
  expect(ambienteDeClipboard({ ...base, env: { DISPLAY: ':0' }, procVersion: 'Linux' })).toBe('x11')
  expect(ambienteDeClipboard({ ...base, env: {}, procVersion: 'Linux', temComando: () => false })).toBe('nenhum')
  expect(ambienteDeClipboard({ ...base, plataforma: 'darwin', env: {}, procVersion: '' })).toBe('macos')
})

test('cada ambiente tem o comando certo, e o do WSL salva no caminho nativo', async () => {
  const { comandoDeColagem } = await import('../motor/mir/clipboard')
  const wsl = comandoDeColagem('wsl', 'C:\\tmp\\ref.bruto')
  expect(wsl?.cmd).toBe('powershell.exe')
  expect(wsl?.saida).toBe('arquivo')
  expect(wsl?.args.join(' ')).toContain('Get-Clipboard -Format Image')
  expect(wsl?.args.join(' ')).toContain("C:\\tmp\\ref.bruto")
  expect(comandoDeColagem('wayland', '')?.cmd).toBe('wl-paste')
  expect(comandoDeColagem('wayland', '')?.args).toContain('image/png')
  expect(comandoDeColagem('x11', '')?.cmd).toBe('xclip')
  expect(comandoDeColagem('nenhum', '')).toBeNull()
})

test('a extensao vem da assinatura do arquivo, nao do que o clipboard diz', async () => {
  const { extensaoPelaAssinatura } = await import('../motor/mir/clipboard')
  expect(extensaoPelaAssinatura(PNG)).toBe('.png')
  expect(extensaoPelaAssinatura(JPG)).toBe('.jpg')
  expect(extensaoPelaAssinatura(Buffer.from('GIF89a'))).toBe('.gif')
  expect(extensaoPelaAssinatura(Buffer.from('BM__'))).toBe('.bmp')
  expect(extensaoPelaAssinatura(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('.webp')
  expect(extensaoPelaAssinatura(Buffer.from('era so texto mesmo'))).toBe('')
})

test('clipboard sem imagem responde o que fazer, em vez de gravar lixo', async () => {
  const { colarImagem } = await import('../motor/mir/clipboard')
  const r = await colarImagem(join(estado, 'ref-1'), deps({ rodar: async () => rodada({ ok: false, code: 3 }) }))
  expect(r.ok).toBe(false)
  expect(r.motivo).toContain('nao ha imagem no clipboard')
  expect(existsSync(join(estado, 'ref-1.bruto'))).toBe(false)
})

test('imagem que vem pela saida padrao e gravada com a extensao da assinatura', async () => {
  const { colarImagem } = await import('../motor/mir/clipboard')
  const r = await colarImagem(join(estado, 'ref-1'), deps({ rodar: async () => rodada({ stdout: PNG }) }))
  expect(r.ok).toBe(true)
  expect(r.caminho).toBe(join(estado, 'ref-1.png'))
  expect(r.bytes).toBe(PNG.length)
  expect(existsSync(join(estado, 'ref-1.bruto'))).toBe(false)
})

test('texto no clipboard e recusado com a saida limpa', async () => {
  const { colarImagem } = await import('../motor/mir/clipboard')
  const r = await colarImagem(join(estado, 'ref-1'), deps({ rodar: async () => rodada({ stdout: Buffer.from('só texto') }) }))
  expect(r.ok).toBe(false)
  expect(r.motivo).toContain('nao e imagem reconhecida')
  expect(existsSync(join(estado, 'ref-1.bruto'))).toBe(false)
})

test('no WSL quem grava o arquivo e o powershell, e o resultado e validado igual', async () => {
  const { colarImagem } = await import('../motor/mir/clipboard')
  const destino = join(estado, 'ref-1')
  const r = await colarImagem(destino, deps({
    ambiente: () => 'wsl',
    rodar: async (cmd) => {
      expect(cmd).toBe('powershell.exe')
      writeFileSync(`${destino}.bruto`, JPG)
      return rodada()
    },
  }))
  expect(r.ok).toBe(true)
  expect(r.caminho).toBe(`${destino}.jpg`)
  expect(r.ambiente).toBe('wsl')
})

test('maquina sem jeito de ler clipboard diz o que instalar', async () => {
  const { colarImagem } = await import('../motor/mir/clipboard')
  const r = await colarImagem(join(estado, 'ref-1'), deps({ ambiente: () => 'nenhum' }))
  expect(r.ok).toBe(false)
  expect(r.motivo).toContain('clipboard')
})

test('/ref sem argumento lista as referencias e o uso de disco', async () => {
  const { comandoRef } = await import('../motor/mir/refs-comando')
  const vazio = await comandoRef('', { tarefa: '010', sessao: 's1' })
  const texto = vazio.linhas.join('\n')
  expect(texto).toContain('tarefa #010')
  expect(texto).toContain('nenhuma ainda')
  expect(texto).toContain('disco 0 MB')
})

test('/ref sem tarefa aberta guarda na sessao e avisa que vai junto com a proxima tarefa', async () => {
  const { comandoRef } = await import('../motor/mir/refs-comando')
  const r = await comandoRef('https://exemplo.com/tela.png', { tarefa: '', sessao: 's1' })
  expect(r.ok).toBe(true)
  expect(r.linhas.join('\n')).toContain('sessao')
  const lista = await comandoRef('', { tarefa: '', sessao: 's1' })
  expect(lista.linhas.join('\n')).toContain('https://exemplo.com/tela.png')
})

test('/ref clipboard anexa a imagem colada na tarefa aberta', async () => {
  const { comandoRef } = await import('../motor/mir/refs-comando')
  const { readRefSources } = await import('../motor/qlb/alf/refs')
  const r = await comandoRef('clipboard', { tarefa: '010', sessao: 's1' }, {
    clipboard: deps(),
    colar: async (destinoSemExt) => {
      writeFileSync(`${destinoSemExt}.png`, PNG)
      return { ok: true, motivo: '', caminho: `${destinoSemExt}.png`, bytes: PNG.length }
    },
  })
  expect(r.ok).toBe(true)
  expect(r.linhas.join('\n')).toContain('do clipboard')
  const fontes = readRefSources('010')
  expect(fontes.length).toBe(1)
  expect(fontes[0]).toContain(join('refs', '010', 'local-1.png'))
})

test('/ref ambiente diz por onde o clipboard seria lido', async () => {
  const { comandoRef } = await import('../motor/mir/refs-comando')
  const r = await comandoRef('ambiente', { tarefa: '', sessao: 's1' }, {
    clipboard: deps({ ambiente: () => 'wsl' }),
    colar: async () => ({ ok: false, motivo: '', caminho: '', bytes: 0 }),
  })
  expect(r.linhas.join('\n')).toContain('wsl')
})

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { MAX_FILESIZE_BYTES, bytesEmDisco } from '../quilombo/alfandega/download.ts'

export type Ambiente = 'wsl' | 'wayland' | 'x11' | 'macos' | 'nenhum'

export interface Sonda {
  env: Record<string, string | undefined>
  procVersion: string
  plataforma: string
  temComando: (nome: string) => boolean
}

function ehWSL(procVersion: string, env: Record<string, string | undefined>): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true
  return /microsoft/i.test(procVersion)
}

export function ambienteDeClipboard(s: Sonda): Ambiente {
  if (ehWSL(s.procVersion, s.env) && s.temComando('powershell.exe')) return 'wsl'
  if (s.plataforma === 'darwin') return 'macos'
  if (s.env.WAYLAND_DISPLAY && s.temComando('wl-paste')) return 'wayland'
  if (s.env.DISPLAY && s.temComando('xclip')) return 'x11'
  if (s.temComando('wl-paste')) return 'wayland'
  if (s.temComando('xclip')) return 'x11'
  return 'nenhum'
}

export interface Colagem {
  cmd: string
  args: string[]
  saida: 'arquivo' | 'stdout'
}

const PS_SALVAR = [
  '$ErrorActionPreference = \'Stop\'',
  '$img = Get-Clipboard -Format Image',
  'if ($null -eq $img) { exit 3 }',
  '$img.Save(\'DESTINO\')',
].join('; ')

export function comandoDeColagem(amb: Ambiente, destinoNativo: string): Colagem | null {
  if (amb === 'wsl') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', PS_SALVAR.replace('DESTINO', destinoNativo)],
      saida: 'arquivo',
    }
  }
  if (amb === 'wayland') return { cmd: 'wl-paste', args: ['--no-newline', '--type', 'image/png'], saida: 'stdout' }
  if (amb === 'x11') return { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], saida: 'stdout' }
  if (amb === 'macos') return { cmd: 'pngpaste', args: [destinoNativo], saida: 'arquivo' }
  return null
}

export function comoObter(amb: Ambiente): string {
  if (amb === 'wayland') return 'instale wl-clipboard (wl-paste)'
  if (amb === 'x11') return 'instale xclip'
  if (amb === 'macos') return 'instale pngpaste (brew install pngpaste)'
  if (amb === 'wsl') return 'powershell.exe precisa estar no PATH do WSL'
  return 'nao achei como ler o clipboard nesta maquina — em terminal remoto (ssh) o clipboard e o da sua maquina, nao o do servidor'
}

const ASSINATURAS: { ext: string; bytes: number[] }[] = [
  { ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: '.bmp', bytes: [0x42, 0x4d] },
]

export function extensaoPelaAssinatura(cabeca: Buffer): string {
  for (const { ext, bytes } of ASSINATURAS) {
    if (bytes.every((b, i) => cabeca[i] === b)) return ext
  }
  if (cabeca.length >= 12 && cabeca.subarray(0, 4).toString('ascii') === 'RIFF' && cabeca.subarray(8, 12).toString('ascii') === 'WEBP') {
    return '.webp'
  }
  return ''
}

export interface Rodada {
  ok: boolean
  code: number
  stdout: Buffer
  erro: string
}

export interface DepsDeColagem {
  rodar: (cmd: string, args: string[]) => Promise<Rodada>
  caminhoNativo: (caminho: string) => Promise<string>
  ambiente: () => Ambiente
}

interface ErroDeExec {
  code?: number | string
  message?: string
}

function rodarComando(cmd: string, args: string[], tetoBytes = MAX_FILESIZE_BYTES + 1024): Promise<Rodada> {
  return new Promise<Rodada>((pronto) => {
    execFile(cmd, args, { maxBuffer: tetoBytes, timeout: 15000, encoding: 'buffer' }, (err, stdout) => {
      const e = err as ErroDeExec | null
      pronto({
        ok: !e,
        code: Number(e?.code ?? 0) || 0,
        stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? '')),
        erro: String(e?.message ?? '').split('\n')[0] ?? '',
      })
    })
  })
}

async function nativoPorWslpath(caminho: string): Promise<string> {
  const r = await rodarComando('wslpath', ['-w', caminho])
  const saida = r.stdout.toString('utf8').trim()
  return r.ok && saida ? saida : caminho
}

export function depsPadrao(): DepsDeColagem {
  return {
    rodar: (cmd, args) => rodarComando(cmd, args),
    caminhoNativo: nativoPorWslpath,
    ambiente: () => ambienteDeClipboard({
      env: process.env,
      procVersion: existsSync('/proc/version') ? readFileSync('/proc/version', 'utf8') : '',
      plataforma: process.platform,
      temComando: (nome) => temNoPath(nome),
    }),
  }
}

function temNoPath(nome: string): boolean {
  const caminhos = (process.env.PATH || '').split(':').filter(Boolean)
  return caminhos.some(dir => existsSync(`${dir}/${nome}`))
}

export interface ResultadoDeColagem {
  ok: boolean
  motivo: string
  caminho: string
  bytes: number
  ambiente: Ambiente
}

const SEM_IMAGEM = 3

function falha(ambiente: Ambiente, motivo: string): ResultadoDeColagem {
  return { ok: false, motivo, caminho: '', bytes: 0, ambiente }
}

export async function colarImagem(destinoSemExt: string, deps: DepsDeColagem = depsPadrao()): Promise<ResultadoDeColagem> {
  const ambiente = deps.ambiente()
  if (ambiente === 'nenhum') return falha(ambiente, comoObter(ambiente))
  const bruto = `${destinoSemExt}.bruto`
  const nativo = ambiente === 'wsl' ? await deps.caminhoNativo(bruto) : bruto
  const cmd = comandoDeColagem(ambiente, nativo)
  if (!cmd) return falha(ambiente, comoObter(ambiente))

  const r = await deps.rodar(cmd.cmd, cmd.args)
  if (cmd.saida === 'stdout') {
    if (r.ok && r.stdout.length) writeFileSync(bruto, r.stdout)
  }
  const limpa = (): void => { rmSync(bruto, { force: true }) }

  if (!r.ok && r.code === SEM_IMAGEM) {
    limpa()
    return falha(ambiente, 'nao ha imagem no clipboard — copie a imagem (ctrl+c / print) e tente de novo')
  }
  if (!r.ok) {
    limpa()
    return falha(ambiente, `${cmd.cmd} falhou${r.erro ? `: ${r.erro}` : ''} — ${comoObter(ambiente)}`)
  }
  if (!existsSync(bruto) || bytesEmDisco(bruto) === 0) {
    limpa()
    return falha(ambiente, 'o clipboard nao devolveu imagem — se voce copiou texto, use /ref <url|caminho>')
  }
  const bytes = bytesEmDisco(bruto)
  if (bytes > MAX_FILESIZE_BYTES) {
    limpa()
    return falha(ambiente, `imagem do clipboard tem ${bytes} bytes, acima do teto de ${MAX_FILESIZE_BYTES}`)
  }
  const ext = extensaoPelaAssinatura(readFileSync(bruto).subarray(0, 16))
  if (!ext) {
    limpa()
    return falha(ambiente, 'o que veio do clipboard nao e imagem reconhecida (png, jpg, gif, bmp ou webp)')
  }
  const caminho = `${destinoSemExt}${ext}`
  writeFileSync(caminho, readFileSync(bruto))
  limpa()
  return { ok: true, motivo: '', caminho, bytes, ambiente }
}

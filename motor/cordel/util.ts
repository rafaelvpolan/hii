export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

export function isoAt(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d+Z$/, 'Z')
}

export function slugify(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tarefa'
}

const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const CONTROLE_SOLTO = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function semControle(texto: string): string {
  return texto.replace(OSC, '').replace(CSI, '').replace(CONTROLE_SOLTO, '')
}

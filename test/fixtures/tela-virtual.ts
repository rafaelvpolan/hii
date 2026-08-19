const CSI = /^\x1b\[([0-9;?]*)([A-Za-z])/

function fimDoOsc(bruto: string, i: number): number {
  const bell = bruto.indexOf('\x07', i)
  const st = bruto.indexOf('\x1b\\', i)
  if (bell >= 0 && (st < 0 || bell < st)) return bell + 1
  if (st >= 0) return st + 2
  return bruto.length
}

export function telaVirtual(saida: string[]): string {
  const bruto = saida.join('')
  const linhas: string[] = []
  let linha = 0
  let coluna = 0

  const escrever = (c: string): void => {
    const atual = linhas[linha] ?? ''
    const preenchida = atual.length < coluna ? atual.padEnd(coluna, ' ') : atual
    linhas[linha] = preenchida.slice(0, coluna) + c + preenchida.slice(coluna + 1)
    coluna += 1
  }

  let i = 0
  while (i < bruto.length) {
    const atual = bruto[i] ?? ''
    if (atual === '\x1b' && bruto[i + 1] === ']') {
      i = fimDoOsc(bruto, i + 2)
      continue
    }
    if (atual === '\x1b') {
      const m = CSI.exec(bruto.slice(i))
      if (!m) { i += 1; continue }
      const args = m[1] ?? ''
      const cmd = m[2] ?? ''
      if (cmd === 'H') {
        const partes = args.split(';')
        linha = Math.max(0, Number(partes[0] || '1') - 1)
        coluna = Math.max(0, Number(partes[1] || '1') - 1)
      } else if (cmd === 'K') {
        linhas[linha] = (linhas[linha] ?? '').slice(0, coluna)
      } else if (cmd === 'J') {
        linhas.length = 0
        linha = 0
        coluna = 0
      }
      i += (m[0] ?? '').length
      continue
    }
    if (atual === '\n') { linha += 1; coluna = 0; i += 1; continue }
    if (atual === '\r') { coluna = 0; i += 1; continue }
    escrever(atual)
    i += 1
  }
  return linhas.map(l => (l ?? '').replace(/\s+$/, '')).join('\n')
}

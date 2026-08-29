// Alicerce — o aviso de arquivo ILEGIVEL, num lugar so.
//
// O padrao que este modulo existe para matar: `catch { return null }` num leitor
// de configuracao. Ele faz "o arquivo nao existe" e "o arquivo esta corrompido"
// terem a MESMA resposta, e as consequencias sao opostas. Ausente e o estado
// inicial normal. Corrompido significa que existe configuracao escrita que o
// motor vai ignorar — gate pulado, provedor trocado, teto nao aplicado — e o
// verde sai igual ao verde de quando tudo funcionou.
//
// Nao lanca: derrubar o daemon por um arquivo de contrato seria trocar um
// problema por um pior. Grita uma vez por caminho, com a CONSEQUENCIA escrita, e
// quem chamou segue com o padrao.

const avisados = new Set<string>()

export function avisarArquivoIlegivel(caminho: string, motivo: string, consequencia: string): void {
  const chave = `${caminho}::${motivo}`
  if (avisados.has(chave)) return
  avisados.add(chave)
  process.stderr.write(`[hicode] ${caminho} existe mas esta ILEGIVEL (${motivo}) — ${consequencia}\n`)
}

export function esquecerAvisosDeArquivo(): void {
  avisados.clear()
}

export function motivoDoErro(e: Error): string {
  return String(e?.message ?? e).slice(0, 160)
}

import { quebrarEmLargura } from '../../tui/layout.ts'
import { larguraDeGrafema, pedacosDe } from '../../tui/largura.ts'

// A caixa corta linhas que nao cabem. Quebre antes dela, inclusive identificadores
// sem espacos, conservando grafemas e as cores entre linhas.
export function quebrarConfig(texto: string, largura: number): string[] {
  const linhas: string[] = []
  let estilo = ''
  for (const linha of quebrarEmLargura(texto, largura)) {
    let atual = estilo
    let colunas = 0
    for (const parte of pedacosDe(linha)) {
      if (parte.ansi) {
        atual += parte.texto
        estilo = /^\x1b\[(?:0)?m$/.test(parte.texto) ? '' : estilo + parte.texto
        continue
      }
      const tamanho = larguraDeGrafema(parte.texto)
      if (colunas + tamanho > largura) {
        linhas.push(atual + (estilo ? '\x1b[0m' : ''))
        atual = estilo
        colunas = 0
      }
      atual += parte.texto
      colunas += tamanho
    }
    linhas.push(atual + (estilo ? '\x1b[0m' : ''))
  }
  return linhas
}

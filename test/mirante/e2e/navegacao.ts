export interface TelaNavegavel {
  texto: () => Promise<string>
  tecla: (tecla: string) => Promise<void>
  esperarTexto: (texto: string) => Promise<void>
  esperarMudanca: (anterior: string) => Promise<void>
}

export async function revelarIndicadores(tela: TelaNavegavel): Promise<void> {
  // A primeira linha de ajuda ainda deixa o catalogo visivel por um frame.
  // A ultima linha confirma que a resposta inteira chegou ao terminal.
  await tela.esperarTexto('/ia padrao gate')
  for (let i = 0; i < 6; i++) {
    const anterior = await tela.texto()
    if (/\[(ok|cota|sem-cli)\]/.test(anterior)) return
    await tela.tecla('PageUp')
    await tela.esperarMudanca(anterior)
  }
  if (!/\[(ok|cota|sem-cli)\]/.test(await tela.texto())) throw new Error('Indicadores de IA nao estao visiveis apos rolagem')
}

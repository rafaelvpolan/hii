// Um titulo tambem existe no historico global e no eco de /new. A selecao e a
// dica confirmam que a tecla ja abriu o board do projeto, depois da repintura.
export function historicoSelecionado(texto: string, projeto: string, sessao: string): boolean {
  return texto.includes('↑↓ escolhe a sessao') &&
    texto.includes(`projeto ${projeto} ·`) &&
    texto.split('\n').some(linha => linha.startsWith(`> #${sessao} `))
}

// RPR — reparador de build por DOMINIO, nao generico.
//
// O padrao veio do ECC, que mantem 8+ desses (go-build-resolver,
// rust-build-resolver, cpp-build-resolver...). A razao de existir: a saida de
// um `composer` quebrado, de um `cargo` quebrado e de um `godot --headless`
// quebrado nao se parecem em nada, e uma instrucao generica de "conserte o
// build" desperdica a tentativa dirigida — que e o unico tipo de tentativa que
// este motor faz.
//
// Adicionar um dominio novo e um arquivo aqui + uma linha no registro. Mesma
// disciplina do harness (TMD).

export interface ReparadorDeBuild {
  readonly id: string
  // Deterministico: olha os arquivos do diff, nunca pergunta para a IA.
  detecta(arquivos: readonly string[]): boolean
  // Agente que sabe consertar neste dominio.
  readonly agente: string
  // Instrucao ESTREITA, com o vocabulario do dominio.
  instrucao(saida: string): string
}

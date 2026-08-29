// Rota — de onde o motor pode ESCREVER, e o que e so referencia.
//
// O incidente que motivou: o pedido citou dois caminhos — "de acordo com o padrao
// barbeiro-frontend/" (referencia) e "executado em ui-lab/leaderboard.html" (alvo)
// — e o motor nao tinha como distinguir. `dirs = [worktree]` com `mode: 'edit'`
// deixa o worktree INTEIRO gravavel, entao o agente editou a referencia. Ele nao
// se alucinou: fez o que estava permitido.
//
// Duas regras que definem este modulo:
//
// 1. SO CLASSIFICA COM MARCA EXPLICITA. Caminho citado sem marcador nao vira alvo
//    nem referencia — fica de fora, e o comportamento e o de sempre (worktree todo
//    gravavel). Adivinhar aqui trocaria "editou onde nao devia" por "nao consegue
//    editar onde devia", que e pior: o primeiro o humano ve no diff, o segundo
//    parece o motor quebrado.
// 2. O RESULTADO VAI PARA O PLANO. Restringir escrita sem o humano ver seria
//    surpresa; o plano e onde ele aprova antes de qualquer gasto.

// Um caminho: tem barra, ou tem extensao conhecida. Nada de heuristica de palavra
// solta — "barbeiro" nao e caminho, "barbeiro-frontend/" e.
const EXTENSOES = 'html?|css|s[ac]ss|less|[cm]?[jt]sx?|vue|svelte|json|ya?ml|md|txt|php|py|rb|go|rs|java|kt|swift|sql|toml|ini|env|sh|mjs|cjs'
const CAMINHO = new RegExp(`(?:[\\w@.-]+\\/)+[\\w@.-]*|[\\w@-]+\\.(?:${EXTENSOES})\\b`, 'gi')

// A marca vem ANTES do caminho, na mesma vizinhanca. Ordem importa: a lista de
// referencia e testada primeiro, porque "de acordo com o padrao X/" tem "com" e
// "o" no meio e nao pode ser lido como alvo.
const MARCA_DE_REFERENCIA = /\b(?:padr(?:ao|oes|ão|ões)|referencia|referência|refer(?:e|ê)ncias|de acordo com|conforme|igual (?:ao?|aos?|a)|igual|baseado (?:em|no|na)|espelh\w*|copi\w+ (?:de|do|da)|como (?:o|a|no|na|em)?|mesm[oa]s? (?:do|da|de)|segue|seguindo)\W{0,24}$/i
// Marca de alvo pede VERBO DE ESCRITA, nunca a preposicao nua. `em|no|na` solto
// era a marca mais comum antes de um caminho de REFERENCIA tambem: "as cores estao
// em referencia/tokens.css, aplique no alvo.html" fazia os DOIS virarem alvo,
// `referencias` ficava vazio, e a checagem se desligava — o incidente voltava com
// uma reformulacao trivial do pedido. Sem verbo, o caminho fica `sem-marca`, que e
// o comportamento de sempre; falso negativo aqui nao restringe nada.
//
// Por que uns verbos aceitam o caminho DIRETO ("ajuste base.css", "edite x.html") e
// outros exigem a preposicao ("aplique EM x.html"): o objeto direto de editar/
// alterar/ajustar E o arquivo escrito; o de aplicar/executar e o que se APLICA —
// "aplicar o padrao design/" tem uma REFERENCIA como objeto direto. A assimetria
// parece arbitraria e nao e.
const MARCA_DE_ALVO = /\b(?:dentro de|arquivo|aplicar? (?:em|no|na)|aplique (?:em|no|na)|aplicando (?:em|no|na)|execut\w+ (?:em|no|na)|feito (?:em|no|na)|fazer (?:em|no|na)|edit\w+|alter\w+|mex\w+ (?:em|no|na)|ajust\w+ ?(?:em|no|na)?|escrev\w+ (?:em|no|na)|cri\w+ (?:em|no|na)|troca\w* (?:em|no|na)|mud\w+ (?:em|no|na)|salv\w+ (?:em|no|na)|grav\w+ (?:em|no|na))\W{0,24}$/i

// "nao/nunca/jamais/sem" + (palavra opcional) + verbo de escrita, colado no
// caminho. O verbo negado nao vira alvo: vira REFERENCIA, porque proibir a escrita e
// exatamente declarar leitura-somente.
const NEGACAO_ANTES_DO_VERBO = /\b(?:n[aã]o|nunca|jamais|sem|evite|evitar)\s+(?:\w+\s+){0,2}(?:edit\w+|alter\w+|mex\w+|mud\w+|troca\w*|escrev\w+|toc\w+|apag\w+|delet\w+|remov\w+|cri\w+|salv\w+|grav\w+|ajust\w+|aplic\w+)\w*\s*(?:em|no|na|nos|nas)?\W{0,24}$/i

export interface EscopoDeEscrita {
  // Onde o agente PODE escrever. Vazio = sem restricao declarada.
  readonly alvos: readonly string[]
  // Caminhos citados como referencia: leitura sim, escrita nao.
  readonly referencias: readonly string[]
  readonly motivo: string
}

export const SEM_ESCOPO: EscopoDeEscrita = {
  alvos: [],
  referencias: [],
  motivo: 'nenhum caminho marcado como alvo ou referencia no pedido — o worktree inteiro segue gravavel',
}

// Pontuacao final tambem sai: "conforme ref/tokens.css." dava `ref/tokens.css.`, que
// nunca casa com o caminho que o git reporta — a referencia existia no card e nao
// barrava nada.
function normalizar(caminho: string): string {
  return caminho.replace(/^\.\//, '').replace(/[.,;:!?)\]}"']+$/, '').replace(/\/+$/, '')
}

export interface CaminhoCitado {
  readonly caminho: string
  readonly papel: 'alvo' | 'referencia' | 'sem-marca'
}

// Exportada para o teste poder olhar a classificacao de cada caminho, e nao so o
// resultado agregado.
export function caminhosCitados(texto: string): CaminhoCitado[] {
  const t = String(texto ?? '')
  const fora: CaminhoCitado[] = []
  for (const m of t.matchAll(CAMINHO)) {
    const bruto = normalizar(m[0] ?? '')
    if (!bruto || bruto.length < 3) continue
    // Caminho que SAI do alvo nao e escopo: `..` e barra inicial dariam um
    // `existsSync` verdadeiro fora do repo (o texto vem do pedido, e o pedido nao
    // manda no sistema de arquivos), e "escreva somente em ../../etc/passwd"
    // chegaria no prompt do agente como instrucao autorizada.
    if (bruto.startsWith('/') || bruto.split('/').includes('..')) continue
    const antes = t.slice(0, m.index ?? 0)
    // NEGACAO antes do verbo de escrita nao e marca de alvo — e o contrario. "nao
    // edite ref/tokens.css" e a frase mais natural para declarar a restricao, e
    // marcava o caminho como ALVO: como "escrever vence ler" (abaixo), o caminho
    // saia de `referencias`, `referencias` ficava vazio, `foraDoEscopo`
    // curto-circuitava, e o prompt passava a AUTORIZAR a escrita ali. A frase que
    // proibia era a que liberava.
    const negado = NEGACAO_ANTES_DO_VERBO.test(antes)
    const papel = MARCA_DE_REFERENCIA.test(antes)
      ? 'referencia'
      : (!negado && MARCA_DE_ALVO.test(antes)) ? 'alvo' : negado ? 'referencia' : 'sem-marca'
    fora.push({ caminho: bruto, papel })
  }
  return fora
}

// `existe` remove falso positivo de PROSA: "esta sendo feito/executado em ..." tem
// uma barra e casa a forma de caminho. Sem o filtro, "feito/executado" seria um
// caminho citado — inofensivo enquanto fica `sem-marca`, mas nao se por azar
// aparecer depois de um marcador. Quem chama passa a checagem contra o disco do
// alvo; sem ela, a leitura fica so pela forma.
export function lerEscopo(texto: string, existe?: (caminho: string) => boolean): EscopoDeEscrita {
  const citados = caminhosCitados(texto).filter(c => !existe || existe(c.caminho))
  const alvos = [...new Set(citados.filter(c => c.papel === 'alvo').map(c => c.caminho))]
  const referencias = [...new Set(citados.filter(c => c.papel === 'referencia').map(c => c.caminho))]
    // Um caminho marcado como alvo em algum ponto NAO e referencia, mesmo que
    // apareca marcado como referencia em outro: escrever vence ler.
    .filter(r => !alvos.includes(r))
  if (!alvos.length && !referencias.length) return SEM_ESCOPO
  const partes: string[] = []
  if (alvos.length) partes.push(`escreve em: ${alvos.join(', ')}`)
  if (referencias.length) partes.push(`so le: ${referencias.join(', ')}`)
  return { alvos, referencias, motivo: partes.join(' · ') }
}

// Um caminho alterado esta FORA do escopo quando cai dentro de uma referencia e
// nao cai dentro de nenhum alvo. Sem alvo declarado, referencia ainda protege:
// "nao escreva aqui" vale por si.
export function foraDoEscopo(escopo: EscopoDeEscrita, alterados: readonly string[]): string[] {
  if (!escopo.referencias.length) return []
  return alterados.filter((a) => {
    const arquivo = normalizar(a)
    if (escopo.alvos.some(alvo => dentroDe(arquivo, alvo))) return false
    return escopo.referencias.some(ref => dentroDe(arquivo, ref))
  })
}

function dentroDe(arquivo: string, base: string): boolean {
  return arquivo === base || arquivo.startsWith(`${base}/`)
}

export function relatoDeEscopo(e: EscopoDeEscrita): string {
  return e.motivo
}

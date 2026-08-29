// MIR — pergunta vs instrucao dentro de uma tarefa aberta.
//
// Antes, TODO texto digitado com a tarefa aberta virava instrucao anexada ao card:
// "o que esta fazendo no barbeiro?" era gravado como pedido de mudanca e nunca
// respondido. Perguntar era impossivel.
//
// A deteccao e automatica (foi a escolha), e o risco dela e conhecido: um pedido
// escrito em forma de pergunta ("pode trocar o azul?") viraria pergunta e nao seria
// aplicado. Por isso duas travas:
//
// 1. PEDIDO EM FORMA DE PERGUNTA continua sendo instrucao. "pode/poderia/consegue/
//    da pra/vamos + verbo" e pedido, nao consulta — mesmo terminando em "?".
// 2. `!` no comeco FORCA instrucao, sempre. Escape deterministico para quando a
//    heuristica errar, em vez de o humano ficar sem saida.

// Pronome/adverbio interrogativo no COMECO: e o sinal mais forte de consulta.
// `oque` junto entra de proposito: e como se digita de verdade, e foi exatamente o
// que o pedido real tinha ("oque esta fazendo no barbeiro?"). Uma deteccao que so
// funciona com a grafia correta nao serve para quem digita rapido.
const ABRE_PERGUNTA = /^\s*(?:o\s*que|oque|o\s*q\b|qual|quais|onde|quando|por\s*que|porque|pq\b|pra\s*que|por\s*qu[eê]|quem|cade|cad[eê])\b/i

// Abertura FRACA: em portugues declarativo estas mesmas palavras comecam
// INSTRUCAO — "tem que trocar o azul", "esta faltando o botao de salvar", "ta
// quebrado o alinhamento", "como combinado, usa o dourado", "quanto ao rodape, usa
// o dourado". Sozinhas viravam pergunta e o texto era descartado: perda silenciosa
// de trabalho, o proprio risco que este modulo existe para travar. Aqui elas so
// contam COM "?" no fim.
const ABRE_TALVEZ = /^\s*(?:que\s+|como|quanto|quantos|quantas|ta\b|t[aá]\b|esta\b|est[aá]\b|tem\b|temos\b|houve\b|deu\b)/i

// Pedido: modal ou convite seguido de acao. Vence o "?" do fim.
const PEDIDO = /^\s*(?:pode|poderia|podes|consegue|conseguiria|da\s*pra|d[aá]\s*para|vamos|vamo|bora|faz|faca|fa[cç]a|troca|trocar|muda|mudar|ajusta|ajustar|corrige|corrigir|remove|remover|adiciona|adicionar|cria|criar|aplica|aplicar|deixa|deixar|coloca|colocar|tira|tirar)\b/i

export const FORCA_INSTRUCAO = '!'

export interface LeituraDaLinha {
  readonly tipo: 'pergunta' | 'instrucao'
  readonly texto: string
  readonly motivo: string
}

export function lerLinhaNaTarefa(bruta: string): LeituraDaLinha {
  const linha = String(bruta ?? '').trim()
  if (linha.startsWith(FORCA_INSTRUCAO)) {
    return {
      tipo: 'instrucao',
      texto: linha.slice(FORCA_INSTRUCAO.length).trim(),
      motivo: `"${FORCA_INSTRUCAO}" no comeco forca instrucao`,
    }
  }
  if (PEDIDO.test(linha)) {
    // O motivo cita o "?" so quando ele existe: mensagem que descreve algo que nao
    // esta na linha confunde mais que ajuda.
    return {
      tipo: 'instrucao',
      texto: linha,
      motivo: linha.endsWith('?') ? 'comeca com pedido de acao — instrucao, mesmo com "?"' : 'comeca com pedido de acao',
    }
  }
  if (ABRE_PERGUNTA.test(linha)) {
    return { tipo: 'pergunta', texto: linha, motivo: 'comeca com pronome interrogativo' }
  }
  if (linha.endsWith('?')) {
    // Abertura fraca + "?" e o caso onde a heuristica mais pode errar, entao o
    // motivo carrega a saida: quem quis instruir escreve "!" na frente.
    return {
      tipo: 'pergunta',
      texto: linha,
      motivo: ABRE_TALVEZ.test(linha)
        ? `termina em "?" — se era instrucao, escreva "${FORCA_INSTRUCAO}" na frente`
        : 'termina em "?"',
    }
  }
  return { tipo: 'instrucao', texto: linha, motivo: 'sem marca de pergunta' }
}

// A diretiva de escape so vale em linha de COMENTARIO nas primeiras linhas do
// arquivo — que e exatamente o que a mensagem dos hooks promete ("no topo do
// arquivo"). Sem a ancora, a regex casava o token em qualquer posicao: no literal
// dela mesma, numa mensagem de erro, na string de um teste. O escape abria sozinho,
// e um portao cujo escape abre sozinho nao e portao.
const LINHAS_DO_TOPO = 10
const RE_DIRETIVA = /^\s*(?:\/\/|\/\*+|\*|#|<!--)\s*hicode:allow-any\b/

export function temDiretivaAny(texto) {
  return texto.split('\n', LINHAS_DO_TOPO).some(l => RE_DIRETIVA.test(l))
}
export const TS_EXT = new Set(['ts', 'tsx', 'mts', 'cts', 'vue'])

const PATTERNS = [
  { re: /:\s*any\b/, kind: ': any' },
  { re: /:\s*unknown\b/, kind: ': unknown' },
  { re: /\bas\s+any\b/, kind: 'as any' },
  { re: /\bas\s+unknown\b/, kind: 'as unknown' },
  { re: /<\s*any\b/, kind: '<any' },
  { re: /<\s*unknown\b/, kind: '<unknown' },
  { re: /\bany\s*\[\]/, kind: 'any[]' },
  { re: /\bunknown\s*\[\]/, kind: 'unknown[]' },
  { re: /[,|&]\s*any\b/, kind: 'any (uniao/generico)' },
  { re: /[,|&]\s*unknown\b/, kind: 'unknown (uniao/generico)' },
]

function blankNonNewline(m) {
  return m.replace(/[^\n]/g, ' ')
}

// Varredura em UMA passada, com estado. Duas regexes independentes nao resolvem
// isto em ordem nenhuma: apagando comentarios primeiro, uma string que contenha
// "/*" engole todo o codigo ate o proximo "*/" e esconde os any de dentro;
// apagando strings primeiro, um apostrofo dentro de um comentario abre uma
// "string" que engole o resto do arquivo. So quem varre sabe em que contexto esta.
//
// Limite conhecido e herdado: literal de regex nao e um estado proprio, entao uma
// regex que contenha aspas ainda confunde o scanner. Era assim antes tambem — nao
// e regressao, e o dia em que doer o estado entra aqui.
export function stripNonCode(text) {
  const fora = []
  const manter = c => fora.push(c)
  const apagar = c => fora.push(c === '\n' ? '\n' : ' ')
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    const d = i + 1 < n ? text[i + 1] : ''
    if (c === '/' && d === '/') {
      while (i < n && text[i] !== '\n') { apagar(text[i]); i++ }
      continue
    }
    if (c === '/' && d === '*') {
      apagar(c); apagar(d); i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { apagar(text[i]); i++ }
      if (i < n) { apagar(text[i]); apagar(text[i + 1]); i += 2 }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      apagar(c); i++
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') { apagar(text[i]); i++; if (i < n) { apagar(text[i]); i++ }; continue }
        apagar(text[i]); i++
      }
      if (i < n) { apagar(text[i]); i++ }
      continue
    }
    manter(c); i++
  }
  return fora.join('')
}

// Apaga o que esta FORA dos blocos <script>, em vez de extrair os blocos. Extrair
// descartava as linhas anteriores ao primeiro <script>, e o numero de linha
// reportado ao humano nao correspondia ao arquivo.
export function scriptOnly(text) {
  const RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi
  let fora = blankNonNewline(text)
  let m
  while ((m = RE.exec(text)) !== null) {
    const corpo = m[0].replace(/^<script\b[^>]*>/i, t => blankNonNewline(t)).replace(/<\/script>$/i, t => blankNonNewline(t))
    fora = fora.slice(0, m.index) + corpo + fora.slice(m.index + m[0].length)
  }
  return fora
}

export function findViolations(text, ext) {
  const base = ext === 'vue' ? scriptOnly(text) : text
  const code = stripNonCode(base)
  const out = []
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const p of PATTERNS) {
      if (p.re.test(line)) { out.push({ line: i + 1, kind: p.kind }); break }
    }
  }
  return out
}

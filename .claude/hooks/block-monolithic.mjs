#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const CODE_EXT = new Set(['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'py']);
const MAX_LINES = 350;
const GOD_FUNCS = 20;
const GOD_EXPORTS = 3;
// A diretiva vale so em linha de COMENTARIO nas primeiras linhas — que e o que a
// mensagem deste hook promete la embaixo ("no topo do arquivo"). Sem a ancora a
// regex casava o token em qualquer posicao, inclusive no proprio literal dela: o
// escape abria sozinho e o portao liberava qualquer arquivo que so mencionasse o
// nome da diretiva numa string.
const LINHAS_DO_TOPO = 10;
const RE_DIRETIVA = /^\s*(?:\/\/|\/\*+|\*|#|<!--)\s*hicode:allow-monolith\b/;
function temDiretiva(text) {
  return text.split('\n', LINHAS_DO_TOPO).some(l => RE_DIRETIVA.test(l));
}

function substituirUmaVez(texto, velho, novo) {
  const i = texto.indexOf(velho);
  return i < 0 ? texto : texto.slice(0, i) + novo + texto.slice(i + velho.length);
}

function resultingContent(tool, input) {
  if (tool === 'Write') return input.content || '';
  let base = '';
  try { base = readFileSync(input.file_path, 'utf8'); } catch (e) {
    // Arquivo que existe e nao le NAO e arquivo novo. Tratar os dois igual fazia a
    // medicao valer so sobre o fragmento editado, e um arquivo de 900 linhas passava.
    if (e?.code !== 'ENOENT') throw e;
    base = '';
  }
  const edits = tool === 'MultiEdit'
    ? (input.edits || [])
    : [{ old_string: input.old_string, new_string: input.new_string, replace_all: input.replace_all }];
  let out = base;
  for (const e of edits) {
    if (typeof e.old_string === 'string' && e.old_string.length && out.includes(e.old_string)) {
      // `split/join`, nao `replace`: com padrao string, `replace` interpreta os
      // padroes de substituicao de `$` no texto novo ($&, $`, $', $$), entao um
      // edit cujo novo texto contenha `$&` duplicava o old_string no conteudo
      // MEDIDO e a contagem deixava de corresponder ao arquivo que sera gravado.
      const novo = e.new_string || '';
      // `replace_all` era ignorado: um Edit com replace_all=true que expande N
      // ocorrencias era medido com UMA substituicao, e o portao anti-monolito podia
      // liberar arquivo que passa de MAX_LINES depois de aplicado.
      out = e.replace_all
        ? out.split(e.old_string).join(novo)
        : substituirUmaVez(out, e.old_string, novo);
    } else if (!base) {
      out += (e.new_string || '');
    }
  }
  return out;
}

function scriptOnly(text) {
  const blocks = text.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi);
  if (!blocks) return '';
  return blocks.map(b => b.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '')).join('\n');
}

function codeLines(text) {
  return text.split('\n').filter(l => l.trim() !== '').length;
}

function countFuncs(text) {
  const fn = (text.match(/\bfunction\b/g) || []).length;
  const arrow = (text.match(/\b(?:const|let|var)\s+[\w$]+\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=\n]+)?=>/g) || []).length;
  return fn + arrow;
}

function countExports(text) {
  return (text.match(/\bexport\b/g) || []).length + (text.match(/\bmodule\.exports\b/g) || []).length;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  try {
    const ev = JSON.parse(raw);
    const tool = ev.tool_name;
    const input = ev.tool_input || {};
    const path = input.file_path || '';
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (!CODE_EXT.has(ext)) process.exit(0);

    const content = resultingContent(tool, input);
    if (temDiretiva(content)) process.exit(0);

    const code = ext === 'vue' ? scriptOnly(content) : content;
    const lines = codeLines(code);
    const funcs = countFuncs(code);
    const exports = countExports(code);

    const tooLong = lines > MAX_LINES;
    const godFile = funcs >= GOD_FUNCS && exports < GOD_EXPORTS;
    if (!tooLong && !godFile) process.exit(0);

    const why = [];
    if (tooLong) why.push(`arquivo com ${lines} linhas de codigo (limite ${MAX_LINES})`);
    if (godFile) why.push(`god-file: ${funcs} funcoes e apenas ${exports} export(s) (limite: <${GOD_FUNCS} funcoes ou >=${GOD_EXPORTS} exports)`);

    process.stderr.write(
`BLOQUEADO: codigo monolitico (regra anti-monolito do hicode — CLAUDE.md).

Arquivo: ${path}
Motivo: ${why.join(' + ')}

Separe em modulos coesos: types em um arquivo, helpers puros em outro, e cada
grupo de funcoes/responsabilidade no seu proprio arquivo (< ${MAX_LINES} linhas).
Em .vue, extraia logica para composables e quebre em componentes menores.

Escape (ultimo caso, divida tecnica assumida): inclua a diretiva "hicode:allow-monolith"
numa linha de COMENTARIO nas primeiras ${LINHAS_DO_TOPO} linhas do arquivo.
`);
    process.exit(2);
  } catch (e) {
    // Sair 0 e escolha deliberada: um bug neste hook nao pode travar toda escrita
    // do repo. Sair 0 CALADO e que era o defeito — o portao virava decoracao e
    // ninguem descobria. A causa vai para stderr antes de liberar.
    process.stderr.write(`[hicode] block-monolithic: falhou ao avaliar (${e?.message || e}) — a escrita seguiu SEM verificacao anti-monolito\n`);
    process.exit(0);
  }
});

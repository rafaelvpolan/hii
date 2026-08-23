import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-matriz-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const {
  SECOES_DA_MATRIZ,
  arquivoDaMatriz,
  renderizarTemplate,
  criarMatriz,
  conferirMatriz,
  relatoDaMatriz,
} = await import('../../motor/nmy/luc/matriz-entendimento')

const IDS = SECOES_DA_MATRIZ.map(s => s.id)

function preencherTudo(card: string, texto = 'resposta real do humano'): void {
  const corpo = SECOES_DA_MATRIZ.map(s => `## ${s.titulo}\n\n${texto}, secao ${s.id}\n`).join('\n')
  writeFileSync(arquivoDaMatriz(card), `# Matriz de entendimento — card ${card}\n\n${corpo}`)
}

function carimbarTudo(card: string, texto: string): void {
  const corpo = SECOES_DA_MATRIZ.map(s => `## ${s.titulo}\n\n${texto}\n`).join('\n')
  writeFileSync(arquivoDaMatriz(card), `# Matriz de entendimento — card ${card}\n\n${corpo}`)
}

test('as seis secoes do Pilar 1 estao todas declaradas, e como dado', () => {
  expect(IDS).toEqual(['requisito', 'entrada', 'saida', 'borda', 'risco', 'pronto'])
  expect(new Set(IDS).size, 'id repetido tornaria "faltando" ambiguo').toBe(IDS.length)
})

test('matriz que nao existe nao passa, e o relato diz onde ela deveria estar', () => {
  const v = conferirMatriz('mtz-ausente')
  expect(v.existe).toBe(false)
  expect(v.completa).toBe(false)
  expect(relatoDaMatriz(v)).toContain('matriz-entendimento-mtz-ausente.md')
})

test('ANTI-VACUIDADE o template recem-criado REPROVA — as seis secoes contam como faltando', async () => {
  await criarMatriz('mtz-template', 'um titulo qualquer')
  const v = conferirMatriz('mtz-template')
  expect(v.existe, 'o arquivo foi escrito').toBe(true)
  expect(v.completa, 'template intocado aprovando seria guarda que nao guarda nada').toBe(false)
  expect(v.faltando).toEqual(IDS)
})

test('matriz com as seis secoes respondidas passa', () => {
  preencherTudo('mtz-cheia')
  const v = conferirMatriz('mtz-cheia')
  expect(v.completa).toBe(true)
  expect(v.faltando).toEqual([])
})

test('faltando NOMEIA a secao vazia — nao devolve so um booleano', () => {
  const corpo = SECOES_DA_MATRIZ
    .map(s => (s.id === 'borda' ? `## ${s.titulo}\n` : `## ${s.titulo}\n\nrespondido\n`))
    .join('\n')
  writeFileSync(arquivoDaMatriz('mtz-uma-vazia'), corpo)
  const v = conferirMatriz('mtz-uma-vazia')
  expect(v.completa).toBe(false)
  expect(v.faltando).toEqual(['borda'])
  expect(relatoDaMatriz(v)).toContain('Casos de borda')
})

test('placeholder nao conta como resposta — "TODO", "-", "?" e "a definir" reprovam', () => {
  for (const vazio of ['TODO', 'TBD', '-', '?', 'a definir', '(preencher)', 'n/a']) {
    const corpo = SECOES_DA_MATRIZ
      .map(s => (s.id === 'risco' ? `## ${s.titulo}\n\n${vazio}\n` : `## ${s.titulo}\n\nrespondido\n`))
      .join('\n')
    writeFileSync(arquivoDaMatriz('mtz-ph'), corpo)
    const v = conferirMatriz('mtz-ph')
    expect(v.faltando, `"${vazio}" deveria contar como nao respondido`).toEqual(['risco'])
  }
})

function comSecaoValendo(card: string, id: string, conteudo: string): void {
  const corpo = SECOES_DA_MATRIZ
    .map(s => (s.id === id ? `## ${s.titulo}\n\n${conteudo}\n` : `## ${s.titulo}\n\nrespondido de verdade\n`))
    .join('\n')
  writeFileSync(arquivoDaMatriz(card), corpo)
}

test('ANTI-VACUIDADE lixo FORA da lista de placeholders tambem reprova', () => {
  for (const lixo of ['0', '??', 'N/D', '----', 'k', '1', '.', '::', '42']) {
    comSecaoValendo('mtz-lixo', 'entrada', lixo)
    expect(conferirMatriz('mtz-lixo').faltando, `"${lixo}" nao e resposta`).toEqual(['entrada'])
  }
})

test('ANTI-VACUIDADE caractere invisivel nao vale por resposta', () => {
  for (const invisivel of ['​', '​‌﻿', ' ', '⁠']) {
    comSecaoValendo('mtz-invisivel', 'saida', invisivel)
    expect(conferirMatriz('mtz-invisivel').faltando, 'zero-width preenche a tela e nao preenche nada').toEqual(['saida'])
  }
})

test('ANTI-VACUIDADE placeholder com pontuacao ou palavra colada tambem reprova', () => {
  for (const adiado of ['TODO!', 'pendente.', 'a definir...', 'x todo', 'todo depois', 'wip wip', 'TBD -', 'nao sei ainda']) {
    comSecaoValendo('mtz-adiado', 'pronto', adiado)
    expect(conferirMatriz('mtz-adiado').faltando, `"${adiado}" adia a resposta, nao responde`).toEqual(['pronto'])
  }
})

test('marcador junto de resposta real conta — quem escreveu algo de verdade nao e punido', () => {
  for (const misto of ['TODO: revisar o contrato do alvo', 'wip — devolve lista vazia']) {
    comSecaoValendo('mtz-misto', 'pronto', misto)
    expect(conferirMatriz('mtz-misto').completa, `"${misto}" tem resposta de verdade`).toBe(true)
  }
})

test('ANTI-VACUIDADE marca invisivel no meio do placeholder nao o disfarca de resposta', () => {
  for (const disfarcado of ['todًo.', 'pendًente', 'defًinir', 'preًencher', 'depًois', 'talvًez', 'def️inir']) {
    comSecaoValendo('mtz-marca', 'entrada', disfarcado)
    expect(conferirMatriz('mtz-marca').faltando, 'caractere invisivel nao pode virar bypass').toEqual(['entrada'])
  }
})

test('ANTI-VACUIDADE devolver o texto que o proprio motor escreveu nao e responder', () => {
  const primeira = SECOES_DA_MATRIZ[0]
  const eco = [primeira?.dica ?? '', primeira?.titulo ?? '', `${primeira?.titulo} ${primeira?.titulo}`]
  for (const texto of eco) {
    comSecaoValendo('mtz-eco', 'requisito', texto)
    expect(conferirMatriz('mtz-eco').faltando, `"${texto}" e o enunciado, nao a resposta`).toEqual(['requisito'])
  }
})

test('resposta que MENCIONA o titulo da secao continua contando', () => {
  comSecaoValendo('mtz-mencao', 'requisito', 'o requisito confirmado e cobrar comissao por corte')
  expect(conferirMatriz('mtz-mencao').completa).toBe(true)
})

test('falha real de escrita PROPAGA — o diario nao pode registrar efeito que nao aconteceu', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos')
  mkdirSync(arquivoDaMatriz('mtz-erro'), { recursive: true })
  let lancou = false
  try {
    await criarMatriz('mtz-erro', 'titulo')
  } catch {
    lancou = true
  }
  expect(lancou, 'disco cheio ou permissao negada nao pode passar despercebido').toBe(true)
  expect(eventosDoCard('mtz-erro').filter(e => e.evento === 'efeito_registrado')).toEqual([])
})

test('matriz em disco sem evento no diario conta como reaproveitada — nada foi escrito agora', async () => {
  preencherTudo('mtz-sem-evento', 'resposta que sobreviveu ao crash')
  const r = await criarMatriz('mtz-sem-evento', 'titulo')
  expect(r.reaproveitada, 'o arquivo ja existia; dizer "criei agora" seria mentira').toBe(true)
  expect(readFileSync(arquivoDaMatriz('mtz-sem-evento'), 'utf8')).toContain('sobreviveu ao crash')
})

test('cabecalho com pontuacao a mais continua sendo a secao — nao vira falso negativo', () => {
  const corpo = SECOES_DA_MATRIZ.map(s => `## ${s.titulo}:\n\nrespondido de verdade na secao ${s.id}\n`).join('\n')
  writeFileSync(arquivoDaMatriz('mtz-pontuado'), corpo)
  expect(conferirMatriz('mtz-pontuado').completa).toBe(true)
})

test('ANTI-VACUIDADE a mesma resposta colada nas seis secoes nao e uma matriz', () => {
  carimbarTudo('mtz-copia', 'depende do contrato do alvo estar detectado')
  const v = conferirMatriz('mtz-copia')
  expect(v.completa, 'seis respostas identicas e uma resposta so, repetida').toBe(false)
  expect(v.faltando.length).toBe(SECOES_DA_MATRIZ.length)
})

test('duas secoes podem coincidir sem derrubar a matriz — so o carimbo geral reprova', () => {
  const corpo = SECOES_DA_MATRIZ
    .map((s, i) => `## ${s.titulo}\n\n${i < 2 ? 'nenhum caso conhecido' : `resposta propria da secao ${s.id}`}\n`)
    .join('\n')
  writeFileSync(arquivoDaMatriz('mtz-par-igual'), corpo)
  expect(conferirMatriz('mtz-par-igual').completa).toBe(true)
})

test('resposta curta mas real conta — a regra pede palavra, nao tamanho de texto', () => {
  for (const curta of ['nenhum', 'sim, ja validado na borda', 'lista vazia']) {
    comSecaoValendo('mtz-curta', 'borda', curta)
    expect(conferirMatriz('mtz-curta').completa, `"${curta}" e resposta legitima`).toBe(true)
  }
})

test('subtitulo dentro da secao nao derruba o rastreamento da resposta', () => {
  comSecaoValendo('mtz-subtitulo', 'borda', '### Cenario A\n\nlista vazia devolve zero')
  expect(conferirMatriz('mtz-subtitulo').completa, 'markdown normal nao pode virar falso negativo').toBe(true)
})

test('cabecalho de mesmo nivel nao reconhecido encerra a secao — nao vaza resposta alheia', () => {
  const corpo = [
    `## ${SECOES_DA_MATRIZ[0]?.titulo}`,
    '',
    '## Secao inventada',
    '',
    'texto que nao responde a primeira secao',
    '',
    ...SECOES_DA_MATRIZ.slice(1).map(s => `## ${s.titulo}\n\nrespondido de verdade\n`),
  ].join('\n')
  writeFileSync(arquivoDaMatriz('mtz-vaza'), corpo)
  expect(conferirMatriz('mtz-vaza').faltando).toEqual(['requisito'])
})

test('resposta escrita como citacao conta — o `>` do template mora fora das secoes', () => {
  comSecaoValendo('mtz-citacao', 'risco', '> depende do contrato do alvo estar detectado')
  expect(conferirMatriz('mtz-citacao').completa).toBe(true)
})

test('secao apagada do arquivo conta como faltando — nao some do veredicto', () => {
  const corpo = SECOES_DA_MATRIZ
    .filter(s => s.id !== 'pronto')
    .map(s => `## ${s.titulo}\n\nrespondido\n`)
    .join('\n')
  writeFileSync(arquivoDaMatriz('mtz-sem-secao'), corpo)
  expect(conferirMatriz('mtz-sem-secao').faltando).toEqual(['pronto'])
})

test('IDEMPOTENCIA reexecutar o card NAO sobrescreve a matriz que o humano ja preencheu', async () => {
  const primeira = await criarMatriz('mtz-idem', 'titulo')
  expect(primeira.reaproveitada).toBe(false)
  preencherTudo('mtz-idem', 'o humano respondeu isto e nao pode perder')

  const segunda = await criarMatriz('mtz-idem', 'titulo')
  expect(segunda.reaproveitada, 'o efeito ja constava no diario').toBe(true)
  expect(segunda.caminho).toBe(primeira.caminho)
  expect(readFileSync(arquivoDaMatriz('mtz-idem'), 'utf8')).toContain('nao pode perder')
  expect(conferirMatriz('mtz-idem').completa).toBe(true)
})

test('a criacao entra no diario como efeito, com chave propria', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos')
  const { chaveDeEfeito } = await import('../../motor/qlb/slv/idempotencia')
  await criarMatriz('mtz-diario', 'titulo')
  const efeitos = eventosDoCard('mtz-diario').filter(e => e.evento === 'efeito_registrado')
  expect(efeitos.length).toBe(1)
  expect(efeitos[0]?.chave).toBe(chaveDeEfeito('mtz-diario', 'luc', 'matriz_criada'))
})

test('o template traz as seis secoes e o titulo do card, para o humano saber o que responder', () => {
  const texto = renderizarTemplate('mtz-render', 'somar comissao do barbeiro')
  for (const s of SECOES_DA_MATRIZ) expect(texto, `${s.id} sumiu do template`).toContain(s.titulo)
  expect(texto).toContain('somar comissao do barbeiro')
  expect(texto).toContain('mtz-render')
})

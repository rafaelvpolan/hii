import { gastoDoCard, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, ROOT } from '../../cordel/alicerce/config.ts'
import { readCard } from '../../cordel/store.ts'
import { agentesNexus } from '../../agentes/registro.ts'
import type { AgenteInjetado } from '../../agentes/registro.ts'
import { harnessPorNome, harnessSeExistir } from '../../tomada/registro.ts'
import { runProvider } from '../../euclides/tesouro/confianca.ts'
import { fingerprintDoTrabalho } from '../../oswaldo/orquestracao/evidencias.ts'
import { runGit } from '../../quilombo/git.ts'
import { writeFileAtomic, withFileLock } from '../../oswaldo/mutirao/trava-arquivo.ts'
import { textoPublico } from '../../observabilidade/registro.ts'
import { registrarArtefato } from '../../observabilidade/artefatos.ts'
import { sumTokens } from '../../tomada/uso.ts'

export interface RevisorConfigurado {
  papel: string; provedor: string; modelo?: string; dominio: string
  obrigatorio: boolean; ativo: boolean; riscos?: ('low' | 'high')[]; extensoes?: string[]
}
export interface PoliticaDeRevisao { versao: 1; revisao: number; revisores: RevisorConfigurado[] }
export interface Achado {
  severidade: 'P0' | 'P1' | 'P2' | 'P3'; dominio: string; descricao: string; arquivo: string
  linha: number | null; evidencia: string; recomendacao: string; criterio: string
}
export interface FonteDeParecer { papel: string; provedor: string; modelo: string }
export interface AchadoConsolidado extends Achado { id: string; fontes: FonteDeParecer[] }
export interface Parecer {
  fonte: FonteDeParecer; obrigatorio: boolean; estado: 'aprovado' | 'bloqueado' | 'inconclusivo' | 'desabilitado' | 'nao-aplicavel'
  motivo: string; achados: Achado[]; coberturaCompleta: boolean; arquivos: string[]
  custo: number | null; tokens: number
}
export interface RelatorioDeRevisoes {
  versao: 1; rubrica: 2; tarefa: string; fingerprint: string; head: string; diffHash: string; base: string; politica: string
  instante: string; invalidado: boolean; pareceres: Parecer[]; achados: AchadoConsolidado[]; aprovado: boolean; discordancia: boolean
  custo: number; custoMedido: boolean; tokens: number
  custoIncremental: number; custoIncrementalMedido: boolean; tokensIncrementais: number
}
export interface EntradaDeRevisoes {
  id: string; wt: string; base: string; objetivo: string; risco: 'low' | 'high'
  custoAnterior?: number | null; fingerprintEsperado?: string; nomes: string[]; diff: string; parcial: boolean; criterios: string[]
}
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
const RUBRICAS_V2: Readonly<Record<string, readonly string[]>> = {
  seguranca: ['limites de confianca e autorizacao', 'segredos e dados sensiveis', 'injecao, traversal e efeitos indiretos', 'dependencias e configuracao segura'],
  arquitetura: ['responsabilidade e acoplamento', 'compatibilidade e migracao', 'idempotencia, concorrencia e retomada', 'operacao, rollback e observabilidade'],
  performance: ['complexidade e volume limite', 'concorrencia, filas e backpressure', 'memoria, I/O e chamadas externas', 'medicao antes de alegar melhoria'],
  desempenho: ['complexidade e volume limite', 'concorrencia, filas e backpressure', 'memoria, I/O e chamadas externas', 'medicao antes de alegar melhoria'],
  sql: ['migracao reversivel e compatibilidade', 'locks, indices e plano de consulta', 'integridade, concorrencia e transacao', 'parametrizacao e menor privilegio'],
  banco: ['migracao reversivel e compatibilidade', 'locks, indices e plano de consulta', 'integridade, concorrencia e transacao', 'parametrizacao e menor privilegio'],
  negocio: ['criterio de produto identificado', 'regra e fonte verificavel', 'casos limite e impacto no usuario', 'ausencia de regra permanece pendencia'],
}
export function rubricaDoDominio(dominio: string): readonly string[] {
  const chave = dominio.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return RUBRICAS_V2[chave] ?? ['criterios declarados e evidencia observavel', 'regressoes e casos limite', 'operacao e reversao']
}
export function validarPoliticaDeRevisao(p: PoliticaDeRevisao): void {
  if (!p || p.versao !== 1 || !Number.isSafeInteger(p.revisao) || p.revisao < 1 || !Array.isArray(p.revisores) || p.revisores.length > 8 || !p.revisores.some(r => r?.obrigatorio && r?.ativo)) throw new Error('politica de revisao invalida')
  const ids = new Set<string>()
  for (const r of p.revisores) {
    if (!r || !/^[a-z][a-z0-9_-]{0,63}$/.test(r.papel) || !/^[a-z][a-z0-9_-]{0,63}$/.test(r.provedor) || typeof r.dominio !== 'string' || !r.dominio || r.dominio.length > 100 ||
      typeof r.ativo !== 'boolean' || typeof r.obrigatorio !== 'boolean' || (r.modelo !== undefined && (typeof r.modelo !== 'string' || !r.modelo || r.modelo.length > 200))) throw new Error('revisor invalido')
    const id = JSON.stringify([r.papel, r.provedor, r.modelo || ''])
    if (ids.has(id)) throw new Error('revisor duplicado')
    ids.add(id)
    if (r.riscos && (!Array.isArray(r.riscos) || r.riscos.some(v => !['low', 'high'].includes(v)))) throw new Error('riscos invalidos')
    if (r.extensoes && (!Array.isArray(r.extensoes) || r.extensoes.some(v => typeof v !== 'string' || !/^\.[a-z0-9.]{1,32}$/.test(v)))) throw new Error('extensoes invalidas')
    if (r.obrigatorio && !r.ativo) throw new Error('revisor obrigatorio nao pode estar desabilitado')
  }
}
export function consolidarAchados(pareceres: Parecer[]): AchadoConsolidado[] {
  const mapa = new Map<string, AchadoConsolidado>()
  for (const p of pareceres) for (const a of p.achados) {
    // Apenas equivalencia exata dos campos normalizados; semelhanca nao e identidade.
    const id = sha(JSON.stringify([a.severidade, a.dominio, a.arquivo, a.linha, a.criterio, a.descricao, a.evidencia, a.recomendacao]))
    const anterior = mapa.get(id)
    if (!anterior) mapa.set(id, { ...a, id, fontes: [p.fonte] })
    else if (!anterior.fontes.some(f => JSON.stringify(f) === JSON.stringify(p.fonte))) anterior.fontes.push(p.fonte)
  }
  return [...mapa.values()]
}
function parado(id: string): boolean {
  const fm = readCard(id)?.fm
  return fm?.halt_class === 'humano' || fm?.status === 'PAUSED'
}
function aplicavel(r: RevisorConfigurado, e: EntradaDeRevisoes): boolean {
  return (!r.riscos || r.riscos.includes(e.risco)) && (!r.extensoes?.length || e.nomes.some(n => r.extensoes!.some(x => n.endsWith(x))))
}
function aprovado(pareceres: Parecer[]): boolean {
  return pareceres.every(p => (!p.obrigatorio || ['aprovado', 'nao-aplicavel'].includes(p.estado)) &&
    p.estado !== 'bloqueado' && !p.achados.some(a => ['P0', 'P1'].includes(a.severidade)))
}
function texto(valor: string): boolean { return typeof valor === 'string' && !!valor.trim() && valor.length <= 3000 }
interface RespostaRevisor { estado: string; motivo: string; coberturaCompleta: boolean; arquivos: string[]; achados: Achado[] }
export function analisarParecer(saida: string, r: RevisorConfigurado, e: EntradaDeRevisoes): RespostaRevisor {
  const p = JSON.parse(saida) as RespostaRevisor
  if (!p || !['aprovado', 'bloqueado', 'inconclusivo'].includes(p.estado) || !texto(p.motivo) || typeof p.coberturaCompleta !== 'boolean' ||
    !Array.isArray(p.arquivos) || p.arquivos.some(a => typeof a !== 'string' || !e.nomes.includes(a)) ||
    new Set(p.arquivos).size !== p.arquivos.length || !Array.isArray(p.achados) || p.achados.length > 40) throw new Error('parecer malformado')
  for (const a of p.achados) {
    if (!a || !['P0', 'P1', 'P2', 'P3'].includes(a.severidade) || a.dominio !== r.dominio || !texto(a.descricao) || !texto(a.evidencia) ||
      !texto(a.recomendacao) || !e.criterios.includes(a.criterio) || !e.nomes.includes(a.arquivo) ||
      !(a.linha === null || (Number.isSafeInteger(a.linha) && a.linha > 0))) throw new Error('achado sem evidencia, criterio ou arquivo valido')
  }
  if (p.estado === 'aprovado' && p.achados.some(a => ['P0', 'P1'].includes(a.severidade))) throw new Error('aprovacao contradiz achado bloqueante')
  return p
}
function prompt(r: RevisorConfigurado, a: AgenteInjetado, e: EntradaDeRevisoes): string {
  return [a.prompt, 'Revisao somente leitura. O papel e uma rubrica, nao outra IA independente.',
    'Dominio: ' + r.dominio, 'Rubrica v2:\n- ' + rubricaDoDominio(r.dominio).join('\n- '),
    'Objetivo: ' + e.objetivo, 'Criterios permitidos: ' + e.criterios.join(', '),
    'Arquivos: ' + JSON.stringify(e.nomes), 'Diff completo:\n' + e.diff,
    'Nao execute correcoes. Emita apenas JSON com estado (aprovado/bloqueado/inconclusivo), motivo, coberturaCompleta, arquivos e achados.',
    'Cada achado exige severidade P0/P1/P2/P3, dominio, descricao, arquivo, linha (inteiro ou null), evidencia, recomendacao, criterio.',
    'Sem evidencia ou cobertura completa: inconclusivo. Ausencia de achados nao comprova execucao de testes.'].join('\n\n')
}
export async function executarRevisoes(e: EntradaDeRevisoes, politica: PoliticaDeRevisao, executar: typeof runProvider = runProvider, catalogo: Record<string, AgenteInjetado> = agentesNexus()): Promise<RelatorioDeRevisoes> {
  validarPoliticaDeRevisao(politica)
  if (!/^\d+$/.test(e.id)) throw new Error('tarefa invalida para revisao')
  if (parado(e.id)) throw new Error('Revisao interrompida pelo operador')
  politica = { ...politica, revisores: politica.revisores.map(r => ({
    ...r, modelo: r.modelo || harnessSeExistir(r.provedor)?.modeloPadraoPara('gate'),
  })) }
  const fingerprint = await fingerprintDoTrabalho(e.wt)
  if (e.fingerprintEsperado && e.fingerprintEsperado !== fingerprint) throw new Error('trabalho mudou antes da revisao')
  const base = await runGit(e.wt, ['rev-parse', 'origin/' + e.base])
  const head = await runGit(e.wt, ['rev-parse', 'HEAD'])
  if (head.err) throw new Error('HEAD indisponivel para revisao')
  if (base.err) throw new Error('base indisponivel para revisao')
  const politicaHash = sha(JSON.stringify({ politica, risco: e.risco, nomes: e.nomes, diff: sha(e.diff), parcial: e.parcial,
    rubricas: politica.revisores.map(r => ({ agente: catalogo[r.papel] || null, dominio: rubricaDoDominio(r.dominio) })), criterios: e.criterios, objetivo: e.objetivo, rubrica: 2 }))
  const dir = join(cardsDir(), 'revisoes')
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, e.id + '-' + sha(JSON.stringify([fingerprint, base.stdout.trim(), politicaHash])) + '.json')
  const cache = withFileLock(arquivo, () => {
    if (existsSync(arquivo)) {
      const envelope = JSON.parse(readFileSync(arquivo, 'utf8')) as { hash: string; relatorio: RelatorioDeRevisoes }
      const salvo = envelope.relatorio
      if (!salvo || envelope.hash !== sha(JSON.stringify(salvo)) || salvo.versao !== 1 || salvo.rubrica !== 2 ||
        salvo.tarefa !== e.id || salvo.fingerprint !== fingerprint || salvo.base !== base.stdout.trim() ||
        salvo.head !== head.stdout.trim() || salvo.diffHash !== sha(e.diff) || salvo.politica !== politicaHash || salvo.aprovado !== (!salvo.invalidado && aprovado(salvo.pareceres))) throw new Error('parecer persistido inconsistente')
      return salvo
    }
    // A intencao precede chamadas externas. Queda ou concorrencia exige reconciliacao,
    // nunca outra chamada paga automaticamente para o mesmo fingerprint/politica.
    const intencao = arquivo + '.pendente'
    if (existsSync(intencao)) throw new Error('revisao pendente exige reconciliacao; nenhuma chamada repetida')
    writeFileAtomic(intencao, JSON.stringify({ pid: process.pid, instante: new Date().toISOString() }))
    return null
  })
  if (cache) {
    const baseAtual = await runGit(e.wt, ['rev-parse', 'origin/' + e.base])
    if (baseAtual.err || baseAtual.stdout !== base.stdout) throw new Error('base mudou durante leitura do parecer')
    if (parado(e.id) || await fingerprintDoTrabalho(e.wt) !== fingerprint) throw new Error('trabalho ou estado mudou durante leitura do parecer')
    return { ...cache, custoIncremental: 0, custoIncrementalMedido: true, tokensIncrementais: 0 }
  }
  const pareceres: Parecer[] = []
  const teto = tetoDoCard()
  const gasto = gastoDoCard(readCard(e.id)?.fm.cost_usd)
  const custoAnterior = e.custoAnterior === undefined ? 0 : e.custoAnterior
  const ausentes = politica.revisores.filter(r => r.ativo && r.obrigatorio && aplicavel(r, e) && !catalogo[r.papel])
  for (const r of politica.revisores) {
    const p: Parecer = { fonte: { papel: r.papel, provedor: r.provedor, modelo: r.modelo || '' }, obrigatorio: r.obrigatorio,
      estado: 'inconclusivo', motivo: '', achados: [], coberturaCompleta: false, arquivos: [], custo: 0, tokens: 0 }
    pareceres.push(p)
    if (!r.ativo) { p.estado = 'desabilitado'; p.motivo = 'Revisor opcional desabilitado pela politica.'; continue }
    if (!aplicavel(r, e)) {
      p.estado = 'nao-aplicavel'; p.motivo = 'Fora do risco/arquivos definidos na politica.'; continue
    }
    if (ausentes.length) { p.motivo = 'Catalogo sem revisor obrigatorio: ' + ausentes.map(r => r.papel).join(', '); continue }
    const agente = catalogo[r.papel]
    if (!agente) { p.motivo = 'Papel ausente do catalogo: ' + r.papel; continue }
    if (e.parcial) { p.motivo = 'Diff parcial; cobertura completa nao pode ser declarada.'; continue }
    if (parado(e.id)) { p.motivo = 'Revisao interrompida pelo operador.'; continue }
    const anteriores = pareceres.slice(0, -1)
    if (gasto === null || custoAnterior === null || anteriores.some(p => p.custo === null) ||
      gasto + custoAnterior + anteriores.reduce((n, p) => n + (p.custo || 0), 0) >= teto) {
      p.motivo = 'Orcamento atingido ou custo anterior desconhecido; proxima chamada bloqueada.'; continue
    }
    try {
      const provider = harnessPorNome(r.provedor)
      p.custo = null
      const result = await executar(e.id, provider, { prompt: prompt(r, agente, e), cwd: ROOT, dirs: [e.wt], mode: 'readonly',
        useAgents: false, expectsJson: true, model: r.modelo, timeoutMs: 60000, rotulo: 'review · ' + r.papel + ' · ' + r.provedor }, 'gate')
      p.custo = result.costMeasured && Number.isFinite(result.cost) && result.cost >= 0 ? result.cost : null; p.tokens = sumTokens(result.usage)
      if (!result.ok || result.failed || result.timedOut || result.isError) { p.motivo = textoPublico(result.detail || 'Revisor nao concluiu.'); continue }
      const parsed = analisarParecer(result.text, r, e)
      p.achados = parsed.achados.map(a => ({ ...a, descricao: textoPublico(a.descricao), evidencia: textoPublico(a.evidencia), recomendacao: textoPublico(a.recomendacao) }))
      p.arquivos = parsed.arquivos
      p.coberturaCompleta = parsed.coberturaCompleta && e.nomes.every(n => p.arquivos.includes(n))
      p.estado = p.coberturaCompleta ? parsed.estado as Parecer['estado'] : 'inconclusivo'
      p.motivo = p.coberturaCompleta ? textoPublico(parsed.motivo) : 'Cobertura incompleta do diff.'
    } catch { p.motivo = 'Revisor indisponivel ou parecer invalido; nenhuma aprovacao inferida.' }
  }
  const depois = await runGit(e.wt, ['rev-parse', 'origin/' + e.base])
  const excedeu = gasto === null || custoAnterior === null || gasto + custoAnterior + pareceres.reduce((n, p) => n + (p.custo || 0), 0) > teto
  const mudou = excedeu || parado(e.id) || depois.err || depois.stdout !== base.stdout || await fingerprintDoTrabalho(e.wt) !== fingerprint
  if (mudou) for (const p of pareceres) if (!['desabilitado', 'nao-aplicavel'].includes(p.estado)) { p.estado = 'inconclusivo'; p.motivo = 'Trabalho ou base mudou; parecer invalidado.' }
  const achados = consolidarAchados(pareceres)
  const relatorio: RelatorioDeRevisoes = { versao: 1, rubrica: 2, tarefa: e.id, fingerprint, head: head.stdout.trim(), diffHash: sha(e.diff), base: base.stdout.trim(), politica: politicaHash, instante: new Date().toISOString(), invalidado: !!mudou, pareceres, achados,
    aprovado: !mudou && aprovado(pareceres),
    discordancia: new Set(pareceres.filter(p => ['aprovado', 'bloqueado'].includes(p.estado)).map(p => p.estado)).size > 1,
    custo: pareceres.reduce((s, p) => s + (p.custo || 0), 0), custoMedido: pareceres.every(p => p.custo !== null), tokens: pareceres.reduce((s, p) => s + p.tokens, 0),
    custoIncremental: pareceres.reduce((s, p) => s + (p.custo || 0), 0), custoIncrementalMedido: pareceres.every(p => p.custo !== null), tokensIncrementais: pareceres.reduce((s, p) => s + p.tokens, 0) }
  // Pareceres sao imutaveis para a mesma revisao/rubrica; nova politica explicita
  // permite nova rodada, sem loops automaticos de chamadas pagas.
  withFileLock(arquivo, () => { if (!existsSync(arquivo)) writeFileAtomic(arquivo, JSON.stringify({ hash: sha(JSON.stringify(relatorio)), relatorio }, null, 2)) })
  const fm = readCard(e.id)?.fm || {}
  registrarArtefato({ repo: fm.repo || '', sessao: fm.sessao_id || '', execucao: e.id }, 'revisoes-especializadas', 'application/json', JSON.stringify(relatorio))
  return relatorio
}

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { arquivoDePreferencias, ehEsforco, ESFORCOS } from '../ai/preferencias'
import type { PreferenciasDeIa } from '../ai/preferencias'
import { agentRoles, isProviderName, providerNames, providerNameFor, effortFor, modoFor } from '../ai/registry'
import { provedoresDisponiveis } from '../ai/disponibilidade'
import { modelosDe, arquivoDoCatalogo } from '../ai/catalogo'
import { modosDoProvedor, modoPadraoDoProvedor, temModos, ehModoValido, papelHonraModo } from '../ai/modos'
import type { AgentRole } from '../ai/types'

export interface ResultadoEscolha {
  ok: boolean
  mensagem: string
}

function ehPapel(valor: string): valor is AgentRole {
  return (agentRoles() as string[]).includes(valor)
}

function ler(): PreferenciasDeIa {
  const f = arquivoDePreferencias()
  if (!existsSync(f)) return {}
  try {
    const cru = JSON.parse(readFileSync(f, 'utf8')) as PreferenciasDeIa
    return cru && typeof cru === 'object' ? cru : {}
  } catch {
    return {}
  }
}

function gravar(prefs: PreferenciasDeIa): void {
  const f = arquivoDePreferencias()
  const dir = dirname(f)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${f}.tmp.${process.pid}`
  try {
    writeFileSync(tmp, `${JSON.stringify(prefs, null, 2)}\n`)
    renameSync(tmp, f)
  } catch (erro) {
    rmSync(tmp, { force: true })
    throw erro
  }
}

export interface Ajuste {
  papeis: AgentRole[]
  provider?: string
  model?: string
  effort?: string
  modo?: string
}

export function interpretar(argumentos: string[]): { ajuste?: Ajuste; erro?: string } {
  const partes = argumentos.filter(Boolean)
  if (!partes.length) return { erro: '' }
  const papeis: AgentRole[] = []
  let provider: string | undefined
  let model: string | undefined
  let effort: string | undefined

  for (const bruto of partes) {
    const p = bruto.trim()
    if (ehPapel(p)) { papeis.push(p); continue }
    if (isProviderName(p)) { provider = p; continue }
    if (ehEsforco(p)) { effort = p; continue }
    if (p.startsWith('modelo=') || p.startsWith('model=')) { model = p.split('=')[1] ?? ''; continue }
    if (!model) { model = p; continue }
    return { erro: `nao entendi "${p}"` }
  }

  if (!provider && !model && !effort) {
    return { erro: 'diga ao menos um: provedor, modelo= ou esforco' }
  }
  return { ajuste: { papeis: papeis.length ? papeis : agentRoles(), provider, model, effort } }
}

export function aplicar(ajuste: Ajuste): ResultadoEscolha {
  const prefs = ler()
  for (const papel of ajuste.papeis) {
    const atual = prefs[papel] ?? {}
    const trocouDeProvedor = !!ajuste.provider && ajuste.provider !== atual.provider
    if (ajuste.provider) atual.provider = ajuste.provider
    if (trocouDeProvedor && ajuste.model === undefined) atual.model = undefined
    if (ajuste.model !== undefined) atual.model = ajuste.model || undefined
    if (ajuste.effort) atual.effort = ajuste.effort
    if (ajuste.modo !== undefined) atual.modo = ajuste.modo || undefined
    prefs[papel] = atual
  }
  gravar(prefs)
  const mudou = [
    ajuste.provider ? `ia ${ajuste.provider}` : '',
    ajuste.model ? `modelo ${ajuste.model}` : '',
    ajuste.effort ? `esforco ${ajuste.effort}` : '',
  ].filter(Boolean).join(' · ')
  const onde = ajuste.papeis.length === agentRoles().length ? 'todos os papeis' : ajuste.papeis.join(', ')
  return { ok: true, mensagem: `${mudou} — ${onde} (vale na proxima tarefa, sem reiniciar)` }
}

export function limpar(papeis: AgentRole[]): ResultadoEscolha {
  const prefs = ler()
  for (const p of papeis) delete prefs[p]
  gravar(prefs)
  return { ok: true, mensagem: `voltou ao padrao: ${papeis.join(', ')}` }
}

export function limparEsforco(papeis: AgentRole[]): ResultadoEscolha {
  const prefs = ler()
  for (const papel of papeis) {
    const atual = prefs[papel]
    if (!atual) continue
    delete atual.effort
    prefs[papel] = atual
  }
  gravar(prefs)
  return { ok: true, mensagem: `esforco volta ao padrao da IA: ${papeis.join(', ')}` }
}

export function ciclarModo(role: AgentRole, dir: -1 | 1): ResultadoEscolha {
  const provedor = providerNameFor(role)
  if (!papelHonraModo(role)) return { ok: false, mensagem: `${role} roda em leitura — modo nao se aplica` }
  if (!temModos(provedor)) return { ok: false, mensagem: `${provedor} nao tem modo de operacao` }
  const modos = modosDoProvedor(provedor)
  const atual = modoFor(role)
  const i = atual ? modos.indexOf(atual) : -1
  const proximo = modos[((i < 0 ? 0 : i) + dir + modos.length) % modos.length]
  if (!proximo) return { ok: false, mensagem: 'nao consegui trocar de modo' }
  aplicar({ papeis: [role], modo: proximo })
  return { ok: true, mensagem: `${provedor}: modo ${proximo}` }
}

export function estadoDaIa(): string[] {
  const provedores = provedoresDisponiveis()
  const largura = provedores.reduce((a, p) => Math.max(a, p.nome.length), 0)
  const linhas = ['', '  provedores']
  const rotulo: Record<string, string> = {
    disponivel: 'instalado',
    ausente: 'NAO instalado',
    'precisa-servidor': 'precisa do servidor no ar',
    'nao-autenticado': 'instalado, SEM login',
    'cota-esgotada': 'instalado, cota estourada',
  }
  for (const p of provedores) {
    const uso = p.papeis.length ? `em uso: ${p.papeis.join(', ')}` : 'nenhum papel'
    const modelo = p.modelo ? p.modelo : 'modelo padrao do CLI'
    linhas.push(`    ${p.nome.padEnd(largura)}  ${(rotulo[p.situacao] ?? '').padEnd(26)}  ${modelo} · ${uso}`)
    if (['ausente', 'nao-autenticado', 'cota-esgotada'].includes(p.situacao)) {
      linhas.push(`    ${' '.repeat(largura)}  ${p.comoObter}`)
    }
  }
  linhas.push('', '  papeis')
  for (const item of itensPorPapel()) linhas.push(`    ${item}`)
  return linhas
}

function itensPorPapel(): string[] {
  const prefs = ler()
  return agentRoles().map((papel) => {
    const p = prefs[papel]
    const partes = [
      providerNameFor(papel),
      p?.model ?? '',
      `esforco ${effortFor(papel) ?? '(padrao)'}`,
      p ? '' : '(vindo da env ou do padrao)',
    ].filter(Boolean)
    return `${papel.padEnd(10)}  ${partes.join(' · ')}`
  })
}

export function papelAlvo(partes: string[]): { papel: AgentRole; resto: string[] } {
  const primeiro = partes[0] ?? ''
  if (ehPapel(primeiro)) return { papel: primeiro, resto: partes.slice(1) }
  return { papel: 'implement', resto: partes }
}

export function definirModelo(partes: string[]): ResultadoEscolha {
  const { papel, resto } = papelAlvo(partes)
  const provedor = providerNameFor(papel)
  const escolhido = (resto[0] ?? '').trim()
  if (!escolhido) {
    const opcoes = modelosDe(provedor)
    return {
      ok: false,
      mensagem: opcoes.length
        ? `modelos de ${provedor}: ${opcoes.join(' · ')} — use /model <nome>`
        : `nao conheco modelos de ${provedor} — liste em ${arquivoDoCatalogo()} ou use /model <nome> direto`,
    }
  }
  if (escolhido === 'padrao' || escolhido === 'reset') {
    aplicar({ papeis: [papel], model: '' })
    return { ok: true, mensagem: `${papel}: modelo padrao de ${provedor}` }
  }
  const conhecido = modelosDe(provedor).includes(escolhido)
  aplicar({ papeis: [papel], model: escolhido })
  return {
    ok: true,
    mensagem: `${papel}: ${provedor}/${escolhido}${conhecido ? '' : ' (fora do catalogo — se funcionar, adicione ao arquivo)'}`,
  }
}

export function definirEsforco(partes: string[]): ResultadoEscolha {
  const { papel, resto } = papelAlvo(partes)
  const escolhido = (resto[0] ?? '').trim()
  if (!escolhido) {
    return { ok: false, mensagem: `esforco: ${ESFORCOS.join(' · ')} · padrao — use /effort <nivel>` }
  }
  if (escolhido === 'padrao' || escolhido === 'reset') {
    limparEsforco([papel])
    return { ok: true, mensagem: `${papel}: esforco volta ao padrao da IA` }
  }
  if (!ehEsforco(escolhido)) {
    return { ok: false, mensagem: `"${escolhido}" nao e esforco valido — use: ${ESFORCOS.join(' · ')}` }
  }
  aplicar({ papeis: [papel], effort: escolhido })
  return { ok: true, mensagem: `${papel}: esforco ${escolhido} em ${providerNameFor(papel)}` }
}

export function definirModoDeOperacao(partes: string[]): ResultadoEscolha {
  const { papel, resto } = papelAlvo(partes)
  const provedor = providerNameFor(papel)
  const escolhido = (resto[0] ?? '').trim()
  if (!papelHonraModo(papel)) {
    return { ok: false, mensagem: `${papel} roda em leitura — nao ha edicao para aprovar, entao modo nao se aplica (vale para: implement, step)` }
  }
  if (!temModos(provedor)) {
    return { ok: false, mensagem: `${provedor} nao tem modo de operacao configuravel` }
  }
  if (!escolhido) {
    return { ok: false, mensagem: `modos de ${provedor}: ${modosDoProvedor(provedor).join(' · ')} — use /mode <nome>` }
  }
  if (escolhido === 'padrao' || escolhido === 'reset') {
    aplicar({ papeis: [papel], modo: '' })
    return { ok: true, mensagem: `${papel}: modo padrao de ${provedor} (${modoPadraoDoProvedor(provedor)})` }
  }
  if (!ehModoValido(provedor, escolhido)) {
    return { ok: false, mensagem: `"${escolhido}" nao e modo valido de ${provedor} — use: ${modosDoProvedor(provedor).join(' · ')}` }
  }
  aplicar({ papeis: [papel], modo: escolhido })
  return { ok: true, mensagem: `${papel}: modo ${escolhido} em ${provedor}` }
}

export function ajuda(): string[] {
  return [
    '',
    `  provedores: ${providerNames().join(' · ')}`,
    `  papeis: ${agentRoles().join(' · ')}`,
    `  esforco: ${ESFORCOS.join(' · ')}`,
    '',
    '  /ia claude                      troca a ia (todos os papeis)',
    '  /ia gate codex                  troca a ia so do gate',
    '  /model opus                     modelo da ia atual (papel implement)',
    '  /model gate opus                modelo da ia do gate',
    '  /model padrao                   volta ao modelo padrao do CLI',
    '  /effort high                    esforco da ia atual',
    '  /effort gate max                esforco do gate',
    '  /mode plan                      modo de operacao da ia atual',
    '  /ia padrao gate                 volta o gate ao padrao',
  ]
}

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { arquivoDePreferencias, ehEsforco, ESFORCOS, gauntletLigado } from '../tomada/preferencias.ts'
import { motivoDoErro } from '../cordel/alicerce/aviso.ts'
import type { PreferenciasDeIa } from '../tomada/preferencias.ts'
import { agentRoles, isProviderName, providerNames, providerNameFor, effortFor, modoFor } from '../tomada/registro.ts'
import { provedoresDisponiveis } from '../tomada/disponibilidade.ts'
import { modelosDe, arquivoDoCatalogo } from '../tomada/catalogo.ts'
import { modosDoProvedor, modoPadraoDoProvedor, temModos, ehModoValido, papelHonraModo } from '../tomada/modos.ts'
import type { AgentRole } from '../tomada/tipos.ts'

export interface ResultadoEscolha {
  ok: boolean
  mensagem: string
}

function ehPapel(valor: string): valor is AgentRole {
  return (agentRoles() as string[]).includes(valor)
}

// SEGUNDO leitor do mesmo config/ia.json. Aqui o silencio era pior que no leitor
// de motor/tomada/preferencias.ts, porque este e um read-modify-WRITE: com o arquivo
// ilegivel, `ler()` devolvia `{}`, `gravar()` escrevia um objeto com SO o papel
// ajustado, e a escolha de provedor/modelo/esforco/modo/gauntlet de TODOS os
// outros papeis era destruida — com a mensagem dizendo "vale na proxima tarefa",
// como se nada tivesse sido perdido.
//
// LANCA, e nao devolve padrao: quem chama esta funcao esta prestes a SOBRESCREVER
// o arquivo. Recusar a escrita preserva o que ainda esta lah para o humano
// consertar; seguir em frente apaga.
function ler(): PreferenciasDeIa {
  const f = arquivoDePreferencias()
  if (!existsSync(f)) return {}
  let cru: PreferenciasDeIa | null = null
  try {
    cru = JSON.parse(readFileSync(f, 'utf8')) as PreferenciasDeIa | null
  } catch (e) {
    throw new Error(`${f} esta ILEGIVEL (${motivoDoErro(e as Error)}) — recusei mexer nele: gravar por cima apagaria a escolha de ia de todos os outros papeis. Conserte o JSON, ou apague o arquivo para recomecar do padrao.`)
  }
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
    throw new Error(`${f} nao contem um objeto de papeis — recusei mexer nele para nao apagar o que estiver la. Conserte o arquivo, ou apague-o para recomecar do padrao.`)
  }
  return cru
}

// NENHUMA funcao exportada deste modulo lanca. O motivo e concreto: `aplicar` e
// `ciclarModo` sao chamados de dentro do handler de TECLA da TUI
// (bin/repl.ts -> app.ts onKey -> screen.ts `inp.on('data')`), que nao tem catch —
// uma excecao ali mata o processo com o terminal em raw mode, sem restaurar. Antes
// do `ler()` passar a lancar isso era um `{}` silencioso; trocar silencio por morte
// da TUI seria piorar.
//
// Quem precisa saber se a escrita aconteceu le `ok` do ResultadoEscolha.
function comoMensagem(corpo: () => ResultadoEscolha): ResultadoEscolha {
  try {
    return corpo()
  } catch (e) {
    return { ok: false, mensagem: String((e as Error).message ?? e) }
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
  gauntlet?: boolean
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
    // Token solto vale como MODELO so depois de um provedor nomeado — que e a forma
    // documentada `/ia claude opus`. Antes qualquer palavra virava modelo, entao
    // `/ia provedor-que-nao-existe` era ACEITO e gravado como modelo em todos os
    // papeis: o operador pedia uma ia e o motor trocava o modelo de todas elas.
    if (provider && !model) { model = p; continue }
    return { erro: `nao entendi "${p}" — provedores: ${providerNames().join(' · ')}. Para trocar o modelo use "modelo=${p}" ou /model ${p}` }
  }

  if (!provider && !model && !effort) {
    return { erro: 'diga ao menos um: provedor, modelo= ou esforco' }
  }
  return { ajuste: { papeis: papeis.length ? papeis : agentRoles(), provider, model, effort } }
}

export function aplicar(ajuste: Ajuste): ResultadoEscolha {
  return comoMensagem(() => aplicarInterno(ajuste))
}

function aplicarInterno(ajuste: Ajuste): ResultadoEscolha {
  const prefs = ler()
  for (const papel of ajuste.papeis) {
    const atual = prefs[papel] ?? {}
    const trocouDeProvedor = !!ajuste.provider && ajuste.provider !== atual.provider
    if (ajuste.provider) atual.provider = ajuste.provider
    if (trocouDeProvedor && ajuste.model === undefined) atual.model = undefined
    if (ajuste.model !== undefined) atual.model = ajuste.model || undefined
    if (ajuste.effort) atual.effort = ajuste.effort
    if (ajuste.modo !== undefined) atual.modo = ajuste.modo || undefined
    if (ajuste.gauntlet !== undefined) atual.gauntlet = ajuste.gauntlet || undefined
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
  return comoMensagem(() => limparInterno(papeis))
}

function limparInterno(papeis: AgentRole[]): ResultadoEscolha {
  const prefs = ler()
  for (const p of papeis) delete prefs[p]
  gravar(prefs)
  return { ok: true, mensagem: `voltou ao padrao: ${papeis.join(', ')}` }
}

export function limparEsforco(papeis: AgentRole[]): ResultadoEscolha {
  return comoMensagem(() => limparEsforcoInterno(papeis))
}

function limparEsforcoInterno(papeis: AgentRole[]): ResultadoEscolha {
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
  return comoMensagem(() => ciclarModoInterno(role, dir))
}

function ciclarModoInterno(role: AgentRole, dir: -1 | 1): ResultadoEscolha {
  const provedor = providerNameFor(role)
  if (!papelHonraModo(role)) return { ok: false, mensagem: `${role} roda em leitura — modo nao se aplica` }
  if (!temModos(provedor)) return { ok: false, mensagem: `${provedor} nao tem modo de operacao` }
  const modos = modosDoProvedor(provedor)
  const atual = modoFor(role)
  const i = atual ? modos.indexOf(atual) : -1
  const proximo = modos[((i < 0 ? 0 : i) + dir + modos.length) % modos.length]
  if (!proximo) return { ok: false, mensagem: 'nao consegui trocar de modo' }
  aplicarInterno({ papeis: [role], modo: proximo })
  return { ok: true, mensagem: `${provedor}: modo ${proximo}` }
}

export const GAUNTLET_LIGADOS = ['on', 'ligado', 'sim', '1'] as const
export const GAUNTLET_DESLIGADOS = ['off', 'desligado', 'nao', '0'] as const

// O gauntlet substitui o criterio escrito no lugar de somar: quando ele roda,
// nenhuma revisao automatica LE o diff — ela compara telas. Por isso o
// interruptor e explicito e a mensagem diz o que muda, em vez de so "on/off".
export function definirGauntlet(partes: string[]): ResultadoEscolha {
  return comoMensagem(() => definirGauntletInterno(partes))
}

function definirGauntletInterno(partes: string[]): ResultadoEscolha {
  const escolhido = (partes[0] ?? '').trim().toLowerCase()
  const ligado = gauntletLigado()
  if (!escolhido) {
    return {
      ok: true,
      mensagem: `gauntlet ${ligado ? 'LIGADO' : 'desligado'} — /gauntlet ${ligado ? 'off' : 'on'} troca. Ligado, o crivo julga por comparacao cega de telas (precisa de pack visual, referencia anexada e ia que le imagem) e NAO le o diff; desligado, le o diff contra o criterio escrito.`,
    }
  }
  const alvo = (GAUNTLET_LIGADOS as readonly string[]).includes(escolhido)
    ? true
    : (GAUNTLET_DESLIGADOS as readonly string[]).includes(escolhido)
      ? false
      : (escolhido === 'toggle' || escolhido === 'alterna') ? !ligado : undefined
  if (alvo === undefined) {
    return { ok: false, mensagem: `"${escolhido}" nao e valor de gauntlet — use: on · off · toggle` }
  }
  const escrita = aplicar({ papeis: ['gate'], gauntlet: alvo })
  if (!escrita.ok) return escrita
  return {
    ok: true,
    mensagem: alvo
      ? 'gauntlet LIGADO no crivo — comparacao cega de telas quando o card tiver pack visual e referencia anexada; nesses cards o criterio escrito NAO roda'
      : 'gauntlet desligado — o crivo le o diff contra o criterio escrito, sempre',
  }
}

// `/ia` e o comando que MOSTRA o estado: ele nao pode morrer justamente quando o
// arquivo esta quebrado. Degrada para a explicacao, e segue mostrando o que da.
export function estadoDaIa(): string[] {
  try {
    return estadoDaIaInterno()
  } catch (e) {
    return ['', `  ${String((e as Error).message ?? e)}`]
  }
}

function estadoDaIaInterno(): string[] {
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
  return comoMensagem(() => definirModeloInterno(partes))
}

function definirModeloInterno(partes: string[]): ResultadoEscolha {
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
    const escrita = aplicar({ papeis: [papel], model: '' })
    if (!escrita.ok) return escrita
    return { ok: true, mensagem: `${papel}: modelo padrao de ${provedor}` }
  }
  const conhecido = modelosDe(provedor).includes(escolhido)
  const escrita = aplicar({ papeis: [papel], model: escolhido })
  if (!escrita.ok) return escrita
  return {
    ok: true,
    mensagem: `${papel}: ${provedor}/${escolhido}${conhecido ? '' : ' (fora do catalogo — se funcionar, adicione ao arquivo)'}`,
  }
}

export function definirEsforco(partes: string[]): ResultadoEscolha {
  return comoMensagem(() => definirEsforcoInterno(partes))
}

function definirEsforcoInterno(partes: string[]): ResultadoEscolha {
  const { papel, resto } = papelAlvo(partes)
  const escolhido = (resto[0] ?? '').trim()
  if (!escolhido) {
    return { ok: false, mensagem: `esforco: ${ESFORCOS.join(' · ')} · padrao — use /effort <nivel>` }
  }
  if (escolhido === 'padrao' || escolhido === 'reset') {
    const escrita = limparEsforco([papel])
    if (!escrita.ok) return escrita
    return { ok: true, mensagem: `${papel}: esforco volta ao padrao da IA` }
  }
  if (!ehEsforco(escolhido)) {
    return { ok: false, mensagem: `"${escolhido}" nao e esforco valido — use: ${ESFORCOS.join(' · ')}` }
  }
  const escrita = aplicar({ papeis: [papel], effort: escolhido })
  if (!escrita.ok) return escrita
  return { ok: true, mensagem: `${papel}: esforco ${escolhido} em ${providerNameFor(papel)}` }
}

export function definirModoDeOperacao(partes: string[]): ResultadoEscolha {
  return comoMensagem(() => definirModoDeOperacaoInterno(partes))
}

function definirModoDeOperacaoInterno(partes: string[]): ResultadoEscolha {
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
    const escrita = aplicar({ papeis: [papel], modo: '' })
    if (!escrita.ok) return escrita
    return { ok: true, mensagem: `${papel}: modo padrao de ${provedor} (${modoPadraoDoProvedor(provedor)})` }
  }
  if (!ehModoValido(provedor, escolhido)) {
    return { ok: false, mensagem: `"${escolhido}" nao e modo valido de ${provedor} — use: ${modosDoProvedor(provedor).join(' · ')}` }
  }
  const escrita = aplicar({ papeis: [papel], modo: escolhido })
  if (!escrita.ok) return escrita
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
    '  /gauntlet on                    crivo julga telas por comparacao cega (nao le o diff)',
    '  /ia padrao gate                 volta o gate ao padrao',
  ]
}

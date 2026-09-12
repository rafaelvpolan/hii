import { ehEsforco, ESFORCOS, gauntletLigado } from '../tomada/preferencias.ts'
import { agentRoles, isProviderName, providerNames, providerNameFor, effortFor, modelFor } from '../tomada/registro.ts'
import { aplicar, comoMensagem, ler, limparEsforco } from '../tomada/escolha-de-ia.ts'
import type { Ajuste, ResultadoEscolha } from '../tomada/escolha-de-ia.ts'
export { aplicar, ciclarModo, limpar, limparEsforco } from '../tomada/escolha-de-ia.ts'
export type { Ajuste, ResultadoEscolha } from '../tomada/escolha-de-ia.ts'
import { provedoresDisponiveis } from '../tomada/disponibilidade.ts'
import { modelosDe, arquivoDoCatalogo } from '../tomada/catalogo.ts'
import { modosDoProvedor, modoPadraoDoProvedor, temModos, ehModoValido, papelHonraModo } from '../tomada/modos.ts'
import type { AgentRole } from '../tomada/tipos.ts'

function ehPapel(valor: string): valor is AgentRole {
  return (agentRoles() as string[]).includes(valor)
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

function indicadorDaSituacao(situacao: string): string {
  if (situacao === 'disponivel') return '[ok]'
  if (situacao === 'nao-autenticado') return '[login]'
  if (situacao === 'cota-esgotada') return '[cota]'
  if (situacao === 'ausente') return '[sem-cli]'
  if (situacao === 'precisa-servidor') return '[servidor]'
  return '[?]'
}

function situacaoEmPortugues(situacao: string): string {
  if (situacao === 'disponivel') return 'disponivel'
  if (situacao === 'nao-autenticado') return 'sem login'
  if (situacao === 'cota-esgotada') return 'cota expirada'
  if (situacao === 'ausente') return 'CLI ausente'
  if (situacao === 'precisa-servidor') return 'precisa servidor'
  return situacao
}

export function indiceNumerico(token: string | undefined, total: number): number | null {
  if (!token || !/^\d+$/.test(token)) return null
  const indice = Number(token) - 1
  return indice >= 0 && indice < total ? indice : null
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
  provedores.forEach((p, i) => {
    const uso = p.papeis.length ? `em uso: ${p.papeis.join(', ')}` : 'nenhum papel'
    const modelo = p.modelo ? p.modelo : 'modelo padrao do CLI'
    const modelos = modelosDe(p.nome)
    const listaDeModelos = modelos.length ? `modelos: ${modelos.join(', ')}` : `modelos: ${modelo}`
    linhas.push(`    ${String(i + 1).padStart(2)}  ${indicadorDaSituacao(p.situacao)} ${p.nome.padEnd(largura)}  ${(rotulo[p.situacao] ?? '').padEnd(26)}  ${listaDeModelos} · ${uso}`)
    if (['ausente', 'nao-autenticado', 'cota-esgotada'].includes(p.situacao)) {
      linhas.push(`        ${' '.repeat(largura)}  ${p.comoObter}`)
    }
  })
  linhas.push('', '  selecao: /ia <numero|provedor> [modelo] ou /login <numero|provedor> quando aparecer [login]')
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

function listarModelos(provedor: string, papel: AgentRole): string {
  const opcoes = modelosDe(provedor)
  const estado = provedoresDisponiveis().find(p => p.nome === provedor)
  const cabecalho = [
    `modelos de ${provedor} (${papel})`,
    estado ? `${indicadorDaSituacao(estado.situacao)} ${situacaoEmPortugues(estado.situacao)}` : '',
  ].filter(Boolean).join(' · ')
  const linhas = ['', `  ${cabecalho}`]
  if (opcoes.length) {
    opcoes.forEach((m, i) => linhas.push(`    ${String(i + 1).padStart(2)}  ${m}`))
    linhas.push('', '  selecao: /model <numero|nome> · /model padrao volta ao CLI')
  } else {
    const atual = modelFor(papel) || 'modelo padrao do CLI'
    linhas.push(`    modelos conhecidos: ${atual}`)
    linhas.push(`    ${provedor} ainda nao expõe catalogo aqui — cadastre em ${arquivoDoCatalogo()} ou use /model <nome> direto`)
  }
  if (estado && estado.situacao !== 'disponivel') linhas.push(`    aviso: ${estado.comoObter}`)
  return linhas.join('\n')
}

function definirModeloInterno(partes: string[]): ResultadoEscolha {
  const { papel, resto } = papelAlvo(partes)
  const provedor = providerNameFor(papel)
  const escolhido = (resto[0] ?? '').trim()
  if (!escolhido) {
    return { ok: false, mensagem: listarModelos(provedor, papel) }
  }
  if (escolhido === 'padrao' || escolhido === 'reset') {
    const escrita = aplicar({ papeis: [papel], model: '' })
    if (!escrita.ok) return escrita
    return { ok: true, mensagem: `${papel}: modelo padrao de ${provedor}` }
  }
  const opcoes = modelosDe(provedor)
  const porNumero = indiceNumerico(escolhido, opcoes.length)
  const modelo = porNumero === null ? escolhido : opcoes[porNumero] ?? escolhido
  const conhecido = opcoes.includes(modelo)
  const escrita = aplicar({ papeis: [papel], model: modelo })
  if (!escrita.ok) return escrita
  return {
    ok: true,
    mensagem: `${papel}: ${provedor}/${modelo}${conhecido ? '' : ' (fora do catalogo — se funcionar, adicione ao arquivo)'}`,
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

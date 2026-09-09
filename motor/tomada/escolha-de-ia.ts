// Escolha de IA como capacidade do MOTOR (R: do revezamento, 09/09): persistir e
// aplicar provedor/modelo/esforco/modo por papel morava em motor/mirante/ — a
// superficie humana — e por isso o daemon nao tinha como trocar de IA no meio de um
// card: a capacidade de escolher nunca esteve no motor. O nucleo mudou de casa; o
// mirante continua dono do PARSING dos comandos e da apresentacao, como cliente.
// As guardas vieram intactas: ia.json ilegivel RECUSA a escrita (gravar por cima
// apagaria a escolha de todos os outros papeis), e nenhuma funcao exportada lanca —
// aplicar/ciclarModo sao chamados de handler de tecla da TUI, sem catch.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { arquivoDePreferencias } from './preferencias.ts'
import type { PreferenciasDeIa } from './preferencias.ts'
import { motivoDoErro } from '../cordel/alicerce/aviso.ts'
import { agentRoles, providerNameFor, modoFor } from './registro.ts'
import { modosDoProvedor, temModos, papelHonraModo } from './modos.ts'
import type { AgentRole } from './tipos.ts'

export interface ResultadoEscolha {
  ok: boolean
  mensagem: string
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
export function ler(): PreferenciasDeIa {
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
export function comoMensagem(corpo: () => ResultadoEscolha): ResultadoEscolha {
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


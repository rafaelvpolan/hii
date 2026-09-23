import { performance } from 'node:perf_hooks'
import { textoPublico } from '../../observabilidade/registro.ts'
import { agentRoles, providerFor, providerNameFor, modelFor, modoFor, roleProviderEnv, isProviderName } from '../../tomada/registro.ts'
import { preferenciaDoPapel, arquivoDePreferencias } from '../../tomada/preferencias.ts'
import { repoStatus } from '../../cordel/repos.ts'
import { checkGh, checkProvider, checkRecurso, checkDaemon, checkGitPush, checkContract, checkRuntimes, checkProjectConfig } from './doctor.ts'
import type { Check, Severity } from './doctor.ts'
import { conectorExterno, SERVIDOR_NAVEGACAO } from '../../tomada/ponte/mcp.ts'
import type { DisponibilidadeExterna } from '../../tomada/ponte/estado.ts'

export interface SondaDoctor {
  id: string; escopo: string; nome: string; severidade: Severity
  estado: 'confirmado' | 'atencao' | 'falhou' | 'desconhecido'
  detalhe: string; correcao: string; duracaoMs: number; coletadoEm: string
}
export interface ConfiguracaoEfetiva {
  papel: string; provedor: string; modelo: string | null; modo: string | null
  origemProvedor: string; origemModelo: string; origemModo: string; avisos: string[]
}
export interface Diagnostico {
  versao: 1; coletadoEm: string; duracaoMs: number; inferencia: false
  checks: SondaDoctor[]; configuracao: ConfiguracaoEfetiva[]; pior: Severity
}
export function medirCheck(id: string, escopo: string, executar: () => Check): SondaDoctor {
  const inicio = performance.now()
  const coletadoEm = new Date().toISOString()
  try {
    const c = executar()
    return { id, escopo, nome: c.nome, severidade: c.severidade,
      estado: c.severidade === 'ok' ? 'confirmado' : c.severidade === 'aviso' ? 'atencao' : 'falhou',
      detalhe: textoPublico(c.detalhe), correcao: textoPublico(c.conserto), duracaoMs: performance.now() - inicio, coletadoEm }
  } catch (e) {
    return { id, escopo, nome: id, severidade: 'erro', estado: 'desconhecido',
      detalhe: textoPublico(String((e as Error).message)), correcao: 'Resolva a falha da sonda e repita o diagnostico; nao houve inferencia.',
      duracaoMs: performance.now() - inicio, coletadoEm }
  }
}
export async function checkMcp(
  ferramenta = SERVIDOR_NAVEGACAO,
  consultar: (nome: string) => Promise<DisponibilidadeExterna> = conectorExterno,
): Promise<Check> {
  const limite = new Promise<DisponibilidadeExterna>(resolve => {
    const timer = setTimeout(() => resolve({ usavel: false, motivo: 'sonda MCP excedeu 5 segundos; disponibilidade desconhecida', tools: [], transitorio: true }), 5000)
    timer.unref()
  })
  const r = await Promise.race([consultar(ferramenta), limite])
  if (r.usavel) return { nome: 'MCP ' + ferramenta, severidade: 'ok', detalhe: r.tools.length + ' prefixo(s) de ferramenta persistente(s) confirmado(s)', conserto: '' }
  return { nome: 'MCP ' + ferramenta, severidade: 'aviso', detalhe: r.motivo,
    conserto: r.transitorio ? 'Repita a sonda antes de uma tarefa que exija este conector.' : 'Configure/autentique o MCP em escopo persistente; o motor nao executa OAuth.' }
}
async function medirCheckAssincrono(id: string, escopo: string, executar: () => Promise<Check>): Promise<SondaDoctor> {
  const inicio = performance.now()
  const coletadoEm = new Date().toISOString()
  try {
    const c = await executar()
    return { id, escopo, nome: c.nome, severidade: c.severidade,
      estado: c.severidade === 'ok' ? 'confirmado' : c.severidade === 'aviso' ? 'atencao' : 'falhou',
      detalhe: textoPublico(c.detalhe), correcao: textoPublico(c.conserto), duracaoMs: performance.now() - inicio, coletadoEm }
  } catch (e) {
    return { id, escopo, nome: id, severidade: 'erro', estado: 'desconhecido',
      detalhe: textoPublico(String((e as Error).message)), correcao: 'Resolva a falha da sonda e repita o diagnostico; nao houve inferencia.',
      duracaoMs: performance.now() - inicio, coletadoEm }
  }
}
export function configuracaoEfetiva(): ConfiguracaoEfetiva[] {
  return agentRoles().map(papel => {
    const p = preferenciaDoPapel(papel)
    const h = providerFor(papel)
    const env = roleProviderEnv(papel)
    const avisos: string[] = []
    for (const [origem, valor] of [[arquivoDePreferencias(), p.provider], [env, process.env[env]], ['HII_AI_PROVIDER', process.env.HII_AI_PROVIDER]]) {
      if (valor && !isProviderName(valor)) avisos.push('Provedor desconhecido em ' + origem + '; nao foi aplicado.')
    }
    if (p.modo && p.modo !== modoFor(papel)) avisos.push('Modo persistido "' + p.modo + '" normalizado pelo adaptador para "' + (modoFor(papel) || 'nao aplicavel') + '".')
    return { papel, provedor: providerNameFor(papel), modelo: textoPublico(modelFor(papel) || "") || null, modo: modoFor(papel) || null,
      origemProvedor: isProviderName(p.provider) ? arquivoDePreferencias() : isProviderName(process.env[env]) ? env : isProviderName(process.env.HII_AI_PROVIDER) ? 'HII_AI_PROVIDER' : 'padrao do motor',
      origemModelo: p.model ? arquivoDePreferencias() : 'adaptador ' + h.name + ' (env ou padrao)',
      origemModo: p.modo && p.modo === modoFor(papel) ? arquivoDePreferencias() : 'adaptador ' + h.name,
      avisos: avisos.map(textoPublico) }
  })
}
export function checkModelos(): Check {
  const desconhecidos: string[] = []
  const naoVerificados: string[] = []
  for (const papel of agentRoles()) {
    const h = providerFor(papel)
    const modelo = modelFor(papel)
    const modelos = h.modelosDisponiveis()
    if (!modelo || !modelos.length) naoVerificados.push(papel)
    else if (!modelos.includes(modelo)) desconhecidos.push(papel + ': ' + modelo)
  }
  if (desconhecidos.length) return { nome: 'modelos', severidade: 'aviso', detalhe: 'Modelo nao consta do catalogo: ' + desconhecidos.join(', '),
    conserto: 'Confira nome/alias e acesso antes do despacho; catalogo nao comprova disponibilidade da conta.' }
  return { nome: 'modelos', severidade: naoVerificados.length ? 'aviso' : 'ok',
    detalhe: naoVerificados.length ? 'Modelo efetivo nao verificado: ' + naoVerificados.join(', ') : 'Modelos declarados constam do catalogo; acesso remoto nao testado.',
    conserto: 'Nenhuma inferencia foi usada; catalogo local pode estar desatualizado.' }
}
export async function coletarDoctor(): Promise<Diagnostico> {
  const inicio = performance.now()
  const checks = [
    medirCheck('gh', 'host', checkGh), medirCheck('provedores', 'host', checkProvider),
    medirCheck('modelos', 'host', checkModelos), medirCheck('recursos', 'host', checkRecurso),
    medirCheck('daemon', 'host', checkDaemon),
  ]
  checks.push(await medirCheckAssincrono('mcp-' + SERVIDOR_NAVEGACAO, 'host', () => checkMcp()))
  for (const r of repoStatus()) {
    for (const [id, executar] of [
      ['git-push', () => checkGitPush(r.path, r.name)], ['contrato', () => checkContract(r.path)],
      ['runtimes', () => checkRuntimes(r.path)], ['configuracao-projeto', () => checkProjectConfig(r.path, r.name)],
    ] as const) checks.push(medirCheck(id, r.name, executar))
  }
  const configuracao = configuracaoEfetiva()
  for (const c of configuracao) if (c.avisos.length) checks.push(medirCheck('configuracao-' + c.papel, 'host', () => ({
    nome: c.papel, severidade: 'aviso', detalhe: c.avisos.join(' '), conserto: 'Revise a preferencia canonica em ' + arquivoDePreferencias(),
  })))
  return { versao: 1, coletadoEm: new Date().toISOString(), duracaoMs: performance.now() - inicio, inferencia: false, checks, configuracao,
    pior: checks.some(c => c.severidade === 'erro') ? 'erro' : checks.some(c => c.severidade === 'aviso') ? 'aviso' : 'ok' }
}

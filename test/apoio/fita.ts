// Fita de gravacao/replay de chamadas de harness — grava AgentRequest -> AgentResult
// uma vez, reproduz de graca depois. Chamava-se "cassete"; renomeada por pedido (R:
// no PENDENCIAS, 09/09), e a renomeacao veio junto com os quatro consertos que o
// crivo apontou e ninguem tinha feito:
//
// 1. GRAVAR passou a exigir a rodada cara: gravacao e chamada PAGA, e antes o teto
//    de test/apoio/e2e.ts so existia como frase na mensagem de erro. Agora modo que
//    pode gravar sem `rodada` recusa ANTES de gastar.
// 2. `formatoVersao` e validado na leitura. Fita de formato antigo era lida como se
//    fosse do formato corrente; agora reprova mandando regravar. O formato subiu
//    para 2 porque a chave mudou (item 4).
// 3. A escrita e read-modify-write sob trava de arquivo (a mesma trava-arquivo.ts
//    do motor), com escrita atomica: dois testes gravando a mesma fita em paralelo
//    nao se derrubam mais.
// 4. O marcador de diretorio deixou de ser posicional. `<DIR:0>` colidia dois
//    repositorios diferentes que caissem na mesma posicao da lista; o marcador
//    agora carrega o basename (`<DIR:meu-repo>`), que sobrevive a troca de maquina
//    e distingue alvos.
//
// Sobre `regravar`: ele descarta a gravacao antiga de uma chave UMA vez por sessao,
// na primeira chamada — nao a cada chamada. Descartando sempre, tres chamadas iguais
// em regravacao apagavam uma a outra e a fita terminava com uma entrada so: a
// sequencia multi-chamada que `gravar-se-faltar` sabe criar era destruida em
// silencio, justamente no modo que existe para refaze-la.
//
// O que a fita NAO cobre continua registrado no PENDENCIAS: ela envolve
// `Harness.run`, um degrau acima do parser de cada harness.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AgentMode, AgentRequest, AgentResult, Harness } from '../../motor/tomada/tipos.ts'
import { withFileLock, writeFileAtomic } from '../../motor/oswaldo/mutirao/trava-arquivo.ts'
import type { RodadaCara } from './e2e.ts'

export type ModoDaFita = 'reproduzir' | 'gravar-se-faltar' | 'regravar'

export const ENV_MODO_DA_FITA = 'HII_FITA_MODO'

export const FORMATO_DA_FITA = 2

function ehModoDeFitaValido(v: string): v is ModoDaFita {
  return v === 'reproduzir' || v === 'gravar-se-faltar' || v === 'regravar'
}

export function modoDoAmbiente(env: NodeJS.ProcessEnv = process.env): ModoDaFita {
  const doAmbiente = env[ENV_MODO_DA_FITA]
  return doAmbiente !== undefined && ehModoDeFitaValido(doAmbiente) ? doAmbiente : 'reproduzir'
}

export interface PedidoNormalizado {
  readonly prompt: string
  readonly mode: AgentMode
  readonly useAgents: boolean
  readonly model?: string
  readonly effort?: string
  readonly modo?: string
  readonly extraTools?: readonly string[]
  readonly agentsJson?: string
  readonly cwd: string
  readonly dirs: readonly string[]
  readonly temLiveLog: boolean
}

const MARCADOR_CWD = '<CWD>'

function marcadorDoDiretorio(caminho: string, jaUsados: Set<string>): string {
  const nome = basename(caminho) || 'raiz'
  let marcador = `<DIR:${nome}>`
  for (let n = 2; jaUsados.has(marcador); n++) marcador = `<DIR:${nome}~${n}>`
  jaUsados.add(marcador)
  return marcador
}

function construirMapaDeCaminhosAbsolutos(req: AgentRequest): Map<string, string> {
  const mapa = new Map<string, string>()
  const jaUsados = new Set<string>()
  if (req.cwd) mapa.set(req.cwd, MARCADOR_CWD)
  for (const valorDoDir of req.dirs) {
    if (!valorDoDir || mapa.has(valorDoDir)) continue
    mapa.set(valorDoDir, valorDoDir === req.cwd ? MARCADOR_CWD : marcadorDoDiretorio(valorDoDir, jaUsados))
  }
  return mapa
}

function substituirCaminhosNoTexto(texto: string, mapaDeCaminhos: Map<string, string>): string {
  const doMaiorParaOMenor = [...mapaDeCaminhos.entries()].sort((a, b) => b[0].length - a[0].length)
  return doMaiorParaOMenor.reduce((acumulado, [valorDoCaminho, marcador]) => acumulado.split(valorDoCaminho).join(marcador), texto)
}

export function chaveDoPedido(req: AgentRequest): PedidoNormalizado {
  const mapaDeCaminhos = construirMapaDeCaminhosAbsolutos(req)
  return {
    prompt: substituirCaminhosNoTexto(req.prompt, mapaDeCaminhos),
    mode: req.mode,
    useAgents: req.useAgents,
    model: req.model,
    effort: req.effort,
    modo: req.modo,
    extraTools: req.extraTools,
    agentsJson: req.agentsJson === undefined ? undefined : substituirCaminhosNoTexto(req.agentsJson, mapaDeCaminhos),
    cwd: mapaDeCaminhos.get(req.cwd) ?? MARCADOR_CWD,
    dirs: req.dirs.map(valorDoDir => mapaDeCaminhos.get(valorDoDir) ?? valorDoDir),
    temLiveLog: req.liveLog !== undefined,
  }
}

function serializarChaveCanonicamente(chave: PedidoNormalizado): string {
  const dirsSerializados = chave.dirs.map(valorDoDir => JSON.stringify(valorDoDir)).join(',')
  const extraToolsSerializadas = (chave.extraTools ?? []).map(ferramenta => JSON.stringify(ferramenta)).join(',')
  return [
    `agentsJson=${JSON.stringify(chave.agentsJson ?? null)}`,
    `cwd=${JSON.stringify(chave.cwd)}`,
    `dirs=[${dirsSerializados}]`,
    `effort=${JSON.stringify(chave.effort ?? null)}`,
    `extraTools=[${extraToolsSerializadas}]`,
    `mode=${JSON.stringify(chave.mode)}`,
    `modo=${JSON.stringify(chave.modo ?? null)}`,
    `model=${JSON.stringify(chave.model ?? null)}`,
    `prompt=${JSON.stringify(chave.prompt)}`,
    `temLiveLog=${JSON.stringify(chave.temLiveLog)}`,
    `useAgents=${JSON.stringify(chave.useAgents)}`,
  ].join('|')
}

export interface EntradaDaFita {
  readonly chave: PedidoNormalizado
  readonly gravadoEm: string
  readonly duracaoMs: number
  readonly binario: string
  readonly versaoDoBinario?: string
  readonly argv?: readonly string[]
  readonly resultado: AgentResult
}

interface ArquivoDeFita {
  readonly formatoVersao: number
  readonly entradas: EntradaDaFita[]
}

const DIRETORIO_PADRAO_DE_FITAS = join(import.meta.dirname, '..', 'fixtures', 'fitas')

function sanitizarNomeDeFita(nome: string): string {
  const segmentos = nome.split('/').map(s => s.trim()).filter(s => s.length > 0 && s !== '.' && s !== '..')
  if (!segmentos.length) throw new Error(`nome de fita invalido: "${nome}"`)
  return segmentos.join('/')
}

export interface OpcoesDaFita {
  readonly nome: string
  readonly dir?: string
  readonly modo?: ModoDaFita
  readonly rodada?: RodadaCara
  readonly argvDoPedido?: (req: AgentRequest) => readonly string[]
}

function caminhoDoArquivoDaFita(opcoes: OpcoesDaFita): string {
  const dir = opcoes.dir ?? DIRETORIO_PADRAO_DE_FITAS
  return join(dir, `${sanitizarNomeDeFita(opcoes.nome)}.json`)
}

function lerEntradasGravadas(caminho: string): EntradaDaFita[] {
  if (!existsSync(caminho)) return []
  const arquivo = JSON.parse(readFileSync(caminho, 'utf8')) as ArquivoDeFita
  if (arquivo.formatoVersao !== FORMATO_DA_FITA) {
    throw new Error(`fita ${caminho} esta no formato ${JSON.stringify(arquivo.formatoVersao)} e este leitor exige ${FORMATO_DA_FITA} — a chave de gravacao mudou entre formatos, entao ler assim mesmo casaria pedidos errados. Apague o arquivo e regrave (${ENV_MODO_DA_FITA}=regravar).`)
  }
  return Array.isArray(arquivo.entradas) ? arquivo.entradas : []
}

function tentarLerVersaoDoBinario(binario: string): string | undefined {
  try {
    const saida = execFileSync(binario, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return saida || undefined
  } catch {
    return undefined
  }
}

function mensagemDeFitaAusente(caminho: string, chave: PedidoNormalizado, jaConsumidas: number, gravacoesDisponiveis: number): string {
  const motivo = gravacoesDisponiveis === 0
    ? 'nenhuma gravacao bate com esta chave'
    : `esta chave tem ${gravacoesDisponiveis} gravacao(oes), e todas ja foram consumidas nesta rodada (a chamada numero ${jaConsumidas + 1} excede o que foi gravado)`
  return [
    `fita ausente para este pedido (modo 'reproduzir', o padrao — nunca gasta modelo em silencio).`,
    `motivo: ${motivo}`,
    `arquivo esperado: ${caminho}`,
    `chave normalizada:\n${JSON.stringify(chave, null, 2)}`,
    `para gravar: rode com ${ENV_MODO_DA_FITA}=gravar-se-faltar (ou =regravar), a trilha cara habilitada E a rodada cara passada em OpcoesDaFita.rodada (ver test/apoio/e2e.ts).`,
  ].join('\n')
}

function gravarSobTrava(caminho: string, mesclar: (anteriores: EntradaDaFita[]) => EntradaDaFita[]): void {
  mkdirSync(dirname(caminho), { recursive: true })
  withFileLock(caminho, () => {
    const arquivo: ArquivoDeFita = { formatoVersao: FORMATO_DA_FITA, entradas: mesclar(lerEntradasGravadas(caminho)) }
    writeFileAtomic(caminho, JSON.stringify(arquivo, null, 2) + '\n')
  })
}

function exigirRodadaParaGastar(opcoes: OpcoesDaFita, modo: ModoDaFita): RodadaCara {
  if (opcoes.rodada) return opcoes.rodada
  throw new Error(`fita em modo '${modo}' vai GASTAR modelo e nao recebeu a rodada cara (OpcoesDaFita.rodada) — gravar sem teto e gastar sem limite, e ate aqui o teto de test/apoio/e2e.ts existia so como frase na mensagem de erro. Abra a rodada com abrirRodadaCara() e passe-a aqui.`)
}

function semAGravacaoAntigaDaChaveNaPrimeiraRegravacao(anteriores: EntradaDaFita[], modo: ModoDaFita, primeiraDestaChaveNestaSessao: boolean, chaveSerializada: string): EntradaDaFita[] {
  if (modo !== 'regravar' || !primeiraDestaChaveNestaSessao) return anteriores
  return anteriores.filter(entrada => serializarChaveCanonicamente(entrada.chave) !== chaveSerializada)
}

function construirRunComFita(real: Harness, opcoes: OpcoesDaFita): Harness['run'] {
  const caminho = caminhoDoArquivoDaFita(opcoes)
  const quantasVezesJaVistasNestaSessaoPorChave = new Map<string, number>()

  return async function run(req: AgentRequest): Promise<AgentResult> {
    const modo = opcoes.modo ?? modoDoAmbiente()
    const chave = chaveDoPedido(req)
    const chaveSerializada = serializarChaveCanonicamente(chave)
    const indiceNestaSessao = quantasVezesJaVistasNestaSessaoPorChave.get(chaveSerializada) ?? 0
    quantasVezesJaVistasNestaSessaoPorChave.set(chaveSerializada, indiceNestaSessao + 1)

    if (modo !== 'regravar') {
      const entradasGravadas = lerEntradasGravadas(caminho)
      const candidatas = entradasGravadas.filter(entrada => serializarChaveCanonicamente(entrada.chave) === chaveSerializada)
      const entradaAchada = candidatas[indiceNestaSessao]
      if (entradaAchada) return entradaAchada.resultado
      if (modo === 'reproduzir') {
        throw new Error(mensagemDeFitaAusente(caminho, chave, indiceNestaSessao, candidatas.length))
      }
    }

    const rodada = exigirRodadaParaGastar(opcoes, modo)
    const inicio = Date.now()
    const resultado = await real.run(req)
    rodada.registrarChamada(resultado, { argv: opcoes.argvDoPedido?.(req) })
    const novaEntrada: EntradaDaFita = {
      chave,
      gravadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      binario: real.binario,
      versaoDoBinario: tentarLerVersaoDoBinario(real.binario),
      argv: opcoes.argvDoPedido?.(req),
      resultado,
    }
    const primeiraDestaChaveNestaSessao = indiceNestaSessao === 0
    gravarSobTrava(caminho, anteriores => [
      ...semAGravacaoAntigaDaChaveNaPrimeiraRegravacao(anteriores, modo, primeiraDestaChaveNestaSessao, chaveSerializada),
      novaEntrada,
    ])
    return resultado
  }
}

export function envolverComFita(real: Harness, opcoes: OpcoesDaFita): Harness {
  const runComFita = construirRunComFita(real, opcoes)
  return new Proxy(real, {
    get(alvo, propriedade) {
      if (propriedade === 'run') return runComFita
      const valor = Reflect.get(alvo, propriedade)
      return typeof valor === 'function' ? valor.bind(alvo) : valor
    },
  })
}

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentMode, AgentRequest, AgentResult, Harness } from '../../motor/tomada/tipos.ts'

export type ModoDoCassete = 'reproduzir' | 'gravar-se-faltar' | 'regravar'

export const ENV_MODO_CASSETE = 'HICODE_CASSETE_MODO'

function ehModoDeCasseteValido(v: string): v is ModoDoCassete {
  return v === 'reproduzir' || v === 'gravar-se-faltar' || v === 'regravar'
}

export function modoDoAmbiente(env: NodeJS.ProcessEnv = process.env): ModoDoCassete {
  const doAmbiente = env[ENV_MODO_CASSETE]
  return doAmbiente !== undefined && ehModoDeCasseteValido(doAmbiente) ? doAmbiente : 'reproduzir'
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

function marcadorParaDir(indice: number): string {
  return `<DIR:${indice}>`
}

function construirMapaDeCaminhosAbsolutos(req: AgentRequest): Map<string, string> {
  const mapa = new Map<string, string>()
  if (req.cwd) mapa.set(req.cwd, MARCADOR_CWD)
  req.dirs.forEach((valorDoDir, indice) => {
    if (!valorDoDir || mapa.has(valorDoDir)) return
    mapa.set(valorDoDir, valorDoDir === req.cwd ? MARCADOR_CWD : marcadorParaDir(indice))
  })
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

export interface EntradaDoCassete {
  readonly chave: PedidoNormalizado
  readonly gravadoEm: string
  readonly duracaoMs: number
  readonly binario: string
  readonly versaoDoBinario?: string
  readonly argv?: readonly string[]
  readonly resultado: AgentResult
}

interface ArquivoDeCassete {
  readonly formatoVersao: 1
  readonly entradas: EntradaDoCassete[]
}

const DIRETORIO_PADRAO_DE_CASSETES = join(import.meta.dirname, '..', 'fixtures', 'cassetes')

function sanitizarNomeDeCassete(nome: string): string {
  const segmentos = nome.split('/').map(s => s.trim()).filter(s => s.length > 0 && s !== '.' && s !== '..')
  if (!segmentos.length) throw new Error(`nome de cassete invalido: "${nome}"`)
  return segmentos.join('/')
}

export interface OpcoesDoCassete {
  readonly nome: string
  readonly dir?: string
  readonly modo?: ModoDoCassete
  readonly argvDoPedido?: (req: AgentRequest) => readonly string[]
}

function caminhoDoArquivoDeCassete(opcoes: OpcoesDoCassete): string {
  const dir = opcoes.dir ?? DIRETORIO_PADRAO_DE_CASSETES
  return join(dir, `${sanitizarNomeDeCassete(opcoes.nome)}.json`)
}

function lerEntradasGravadas(caminho: string): EntradaDoCassete[] {
  if (!existsSync(caminho)) return []
  const arquivo = JSON.parse(readFileSync(caminho, 'utf8')) as ArquivoDeCassete
  return Array.isArray(arquivo.entradas) ? arquivo.entradas : []
}

function gravarEntradas(caminho: string, entradas: EntradaDoCassete[]): void {
  mkdirSync(dirname(caminho), { recursive: true })
  const arquivo: ArquivoDeCassete = { formatoVersao: 1, entradas }
  writeFileSync(caminho, JSON.stringify(arquivo, null, 2) + '\n')
}

function tentarLerVersaoDoBinario(binario: string): string | undefined {
  try {
    const saida = execFileSync(binario, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return saida || undefined
  } catch {
    return undefined
  }
}

function mensagemDeCasseteAusente(caminho: string, chave: PedidoNormalizado, jaConsumidas: number, gravacoesDisponiveis: number): string {
  const motivo = gravacoesDisponiveis === 0
    ? 'nenhuma gravacao bate com esta chave'
    : `esta chave tem ${gravacoesDisponiveis} gravacao(oes), e todas ja foram consumidas nesta rodada (a chamada numero ${jaConsumidas + 1} excede o que foi gravado)`
  return [
    `cassete ausente para este pedido (modo 'reproduzir', o padrao — nunca gasta modelo em silencio).`,
    `motivo: ${motivo}`,
    `arquivo esperado: ${caminho}`,
    `chave normalizada:\n${JSON.stringify(chave, null, 2)}`,
    `para gravar: rode com ${ENV_MODO_CASSETE}=gravar-se-faltar (ou =regravar) e a trilha cara habilitada (ver test/apoio/e2e.ts).`,
  ].join('\n')
}

function construirRunComCassete(real: Harness, opcoes: OpcoesDoCassete): Harness['run'] {
  const caminho = caminhoDoArquivoDeCassete(opcoes)
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
        throw new Error(mensagemDeCasseteAusente(caminho, chave, indiceNestaSessao, candidatas.length))
      }
    }

    const inicio = Date.now()
    const resultado = await real.run(req)
    const novaEntrada: EntradaDoCassete = {
      chave,
      gravadoEm: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      binario: real.binario,
      versaoDoBinario: tentarLerVersaoDoBinario(real.binario),
      argv: opcoes.argvDoPedido?.(req),
      resultado,
    }
    const entradasAnteriores = lerEntradasGravadas(caminho)
    // `regravar` descarta a gravacao antiga desta chave UMA vez por sessao, na
    // primeira chamada — nao a cada chamada. Descartando sempre, tres chamadas
    // iguais em regravacao apagavam uma a outra e o cassete terminava com UMA
    // entrada: a sequencia multi-chamada que `gravar-se-faltar` sabe criar era
    // destruida em silencio, justamente no modo que existe para refaze-la.
    const primeiraDestaChaveNestaSessao = indiceNestaSessao === 0
    const entradasSemAAntigaDestaChave = modo === 'regravar' && primeiraDestaChaveNestaSessao
      ? entradasAnteriores.filter(entrada => serializarChaveCanonicamente(entrada.chave) !== chaveSerializada)
      : entradasAnteriores
    gravarEntradas(caminho, [...entradasSemAAntigaDestaChave, novaEntrada])
    return resultado
  }
}

export function envolverComCassete(real: Harness, opcoes: OpcoesDoCassete): Harness {
  const runComCassete = construirRunComCassete(real, opcoes)
  return new Proxy(real, {
    get(alvo, propriedade) {
      if (propriedade === 'run') return runComCassete
      const valor = Reflect.get(alvo, propriedade)
      return typeof valor === 'function' ? valor.bind(alvo) : valor
    },
  })
}

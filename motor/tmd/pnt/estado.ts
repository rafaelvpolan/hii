export type EstadoServidor = 'conectado' | 'precisa-auth' | 'desconhecido'

export interface ServidorMcp {
  nome: string
  estado: EstadoServidor
}

const RE_AUTH = /needs authentication|not authenticated|unauthorized/i
const RE_OK = /connected/i

export function lerLinhaDeServidor(linha: string): ServidorMcp | null {
  const bruta = linha.trim()
  const separador = bruta.indexOf(': ')
  if (separador === -1) return null
  const nome = bruta.slice(0, separador).trim()
  if (!nome || nome.includes(' - ')) return null
  const cauda = bruta.slice(separador + 2)
  if (RE_AUTH.test(cauda)) return { nome, estado: 'precisa-auth' }
  if (RE_OK.test(cauda)) return { nome, estado: 'conectado' }
  return { nome, estado: 'desconhecido' }
}

export function lerListaDeServidores(saida: string): ServidorMcp[] {
  return saida.split('\n').map(lerLinhaDeServidor).filter((s): s is ServidorMcp => s !== null)
}

export type EscopoServidor = 'dinamico' | 'persistente' | 'nao-verificavel'

export function lerEscopo(saidaDoGet: string): EscopoServidor {
  if (/scope:\s*dynamic config/i.test(saidaDoGet)) return 'dinamico'
  if (/scope:\s*\S/i.test(saidaDoGet)) return 'persistente'
  return 'nao-verificavel'
}

export interface DisponibilidadeExterna {
  usavel: boolean
  motivo: string
  tools: string[]
  // true = a indisponibilidade pode passar (o binario nao respondeu agora).
  // Quem decide HALT vs retry le isto em vez de assumir terminal para tudo.
  transitorio?: boolean
}

// "Listei e nao achei" e "nao consegui listar" nao podem ter a mesma
// representacao. Enquanto `servidoresComEstado()` devolvia [] nas duas situacoes,
// o motivo entregue ao humano era "nenhum servidor MCP de X aparece em mcp list"
// — afirmacao FALSA quando o binario nao rodou — e a falha ia classificada como
// `terminal`, ou seja HALT sem retry por um erro que muitas vezes e transitorio.
export interface ListaDeServidores {
  readonly servidores: readonly ServidorMcp[]
  // Vazio = consegui listar. Preenchido = a listagem falhou, e este e o motivo.
  readonly falhou: string
}

// Mesma distincao da listagem, agora tambem no ESCOPO: "o binario nao respondeu"
// e "respondeu e nao tem linha de scope" nao podem ter o mesmo valor. Colapsar os
// dois em 'nao-verificavel' fazia um timeout de `claude mcp get` virar HALT sem
// retry, pelo mesmo motivo que a listagem.
export interface EscopoDaConsulta {
  readonly escopo: EscopoServidor
  readonly falhou: string
}

export interface ConsultaMcp {
  servidores: () => Promise<ListaDeServidores>
  escopo: (nome: string) => Promise<EscopoDaConsulta>
  prefixo: (nome: string) => string
}

function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function combinam(ferramenta: string, nome: string): boolean {
  const alvo = normalizar(ferramenta).trim()
  return !!alvo && normalizar(nome).includes(alvo)
}

export async function disponibilidadeExterna(
  ferramenta: string,
  consulta: ConsultaMcp,
): Promise<DisponibilidadeExterna> {
  const lista = await consulta.servidores()
  if (lista.falhou) {
    return {
      usavel: false,
      motivo: `nao consegui LISTAR os servidores MCP para saber se ${ferramenta} existe — isto NAO significa que ele nao existe: ${lista.falhou}`,
      tools: [],
      transitorio: true,
    }
  }
  const candidatos = lista.servidores.filter(s => combinam(ferramenta, s.nome))
  if (!candidatos.length) {
    return { usavel: false, motivo: `nenhum servidor MCP de ${ferramenta} aparece em "claude mcp list"`, tools: [] }
  }
  const conectados = candidatos.filter(s => s.estado === 'conectado')
  if (!conectados.length) {
    return {
      usavel: false,
      motivo: `o conector ${ferramenta} existe mas pede autenticacao — autorize numa sessao interativa (/mcp), o motor nao roda o fluxo OAuth`,
      tools: [],
    }
  }
  const persistentes: string[] = []
  let naoVerificavel = false
  let falhaAoVerificar = ''
  for (const s of conectados) {
    const r = await consulta.escopo(s.nome)
    if (r.escopo === 'persistente') persistentes.push(s.nome)
    if (r.escopo === 'nao-verificavel') naoVerificavel = true
    if (r.falhou && !falhaAoVerificar) falhaAoVerificar = r.falhou
  }
  if (!persistentes.length) {
    if (falhaAoVerificar) {
      return {
        usavel: false,
        motivo: `nao consegui LER o escopo do conector ${ferramenta} — isto NAO significa que ele e dinamico: ${falhaAoVerificar}`,
        tools: [],
        transitorio: true,
      }
    }
    return {
      usavel: false,
      motivo: naoVerificavel
        ? `nao consegui verificar o escopo do conector ${ferramenta} — trato como indisponivel para nao gastar numa capacidade nao confirmada`
        : `o conector ${ferramenta} so existe na sessao interativa (escopo dinamico) — o subprocesso do motor nao o recebe`,
      tools: [],
    }
  }
  return { usavel: true, motivo: '', tools: persistentes.map(consulta.prefixo) }
}

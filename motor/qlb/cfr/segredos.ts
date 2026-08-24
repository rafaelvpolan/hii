import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENV_SECRETS_DIR } from '../../cdl/ali/contrato.ts'
// CFR — Cofre. Segredo portavel: variavel de ambiente e o caminho que SEMPRE
// funciona, e cofre de nuvem e opcional e plugavel.
//
// A regra que faz isso valer: segredo ausente LANCA, nomeando a variavel e onde
// defini-la. Devolver string vazia empurraria a falha para a chamada de IA, longe
// da causa — o operador veria "provedor recusou" em vez de "falta a chave".
//
// Cofre registrado que devolve vazio tambem lanca, em vez de cair calado no
// ambiente: um cofre mal configurado que silenciosamente usa outra fonte e pior
// que um cofre que falha, porque ninguem descobre qual credencial esta em uso.

// Em docker swarm o segredo chega como ARQUIVO em /run/secrets/<nome>, e o nome
// e minusculo por convencao do swarm. Isso e o "cofre opcional e plugavel" do
// item 29: o ambiente continua sendo o caminho que sempre funciona, e o arquivo
// entra quando HICODE_SECRETS_DIR aponta para ele.

export interface ProvedorDeSegredo {
  readonly id: string
  get(nome: string): Promise<string>
}

export const provedorDeAmbiente: ProvedorDeSegredo = {
  id: 'env',
  get: async (nome: string): Promise<string> => process.env[nome] ?? '',
}

export function provedorDeArquivo(diretorio: string): ProvedorDeSegredo {
  return {
    id: 'arquivo',
    get: async (nome: string): Promise<string> => {
      const caminho = join(diretorio, nome.toLowerCase())
      if (!existsSync(caminho)) {
        throw new Error(`segredo ${nome} nao esta montado em ${caminho} — declare o secret no docker-stack.yml e publique com "docker secret create"`)
      }
      return readFileSync(caminho, 'utf8')
    },
  }
}

export function provedorDoAmbienteOuArquivo(): ProvedorDeSegredo {
  const dir = (process.env[ENV_SECRETS_DIR] ?? '').trim()
  return dir ? provedorDeArquivo(dir) : provedorDeAmbiente
}

let atual: ProvedorDeSegredo = provedorDoAmbienteOuArquivo()

export function provedorPadrao(): ProvedorDeSegredo {
  return provedorDeAmbiente
}

export function provedorAtual(): ProvedorDeSegredo {
  return atual
}

export function usarProvedor(p: ProvedorDeSegredo): void {
  atual = p
}

function faltaSegredo(nome: string, provedor: ProvedorDeSegredo): Error {
  if (provedor.id === provedorDeAmbiente.id) {
    return new Error(`segredo ${nome} ausente — defina a variavel de ambiente ${nome} antes de subir o motor (12-factor: config vem do ambiente, nunca de arquivo amarrado a um provedor)`)
  }
  return new Error(`segredo ${nome} ausente no provedor "${provedor.id}" — cofre registrado que devolve vazio nao cai no ambiente, porque isso esconderia cofre mal configurado`)
}

export async function segredo(nome: string): Promise<string> {
  const provedor = atual
  const valor = (await provedor.get(nome)) ?? ''
  if (!valor.trim()) throw faltaSegredo(nome, provedor)
  // Arquivo de secret quase sempre termina em \n, e credencial com quebra de
  // linha invisivel no fim e um dos erros mais chatos de diagnosticar: a API
  // recusa e a mensagem fala de token invalido, nao de espaco em branco.
  return valor.trim()
}

export async function segredoOpcional(nome: string): Promise<string> {
  try {
    return await segredo(nome)
  } catch {
    return ''
  }
}

import { readCard } from '../../cdl/store.ts'
import { conferirMatriz, criarMatriz, relatoDaMatriz } from '../../nmy/luc/matriz-entendimento.ts'

// CTR — a parede humana da Fase 4.
//
// A parede ja existia em forma: a fila so despacha EXECUTING, entao um card em
// READY espera alguem aprovar. O que faltava era CONTEUDO — o humano carimbava
// um plano que nao tinha onde ser lido. Aqui a aprovacao passa a exigir a
// matriz de entendimento (item 20) respondida.
//
// Este modulo diz se a parede esta satisfeita. Ele NAO decide se isso barra:
// essa politica mora em quem chama, atras de rigorEstrito(), igual aos itens 5
// e 22 da Onda 5. Com o interruptor desligado o veredicto vai para o card do
// mesmo jeito — quem aprovou sem matriz fica visivel antes de a barreira
// comecar a valer.

export interface ParedeDoPlano {
  readonly satisfeito: boolean
  readonly motivo: string
}

export function conferirParedeDoPlano(card: string): ParedeDoPlano {
  const matriz = conferirMatriz(card)
  return { satisfeito: matriz.completa, motivo: relatoDaMatriz(matriz) }
}

export interface MatrizPreparada {
  readonly ok: boolean
  readonly caminho: string
  readonly relato: string
  readonly parede: ParedeDoPlano
}

const PAREDE_SEM_CARD: ParedeDoPlano = { satisfeito: false, motivo: 'card inexistente' }

export async function prepararMatriz(card: string): Promise<MatrizPreparada> {
  const encontrado = readCard(card)
  if (!encontrado) {
    return { ok: false, caminho: '', relato: `card #${card} nao encontrado`, parede: PAREDE_SEM_CARD }
  }
  const criada = await criarMatriz(card, encontrado.fm.title ?? '')
  const parede = conferirParedeDoPlano(card)
  return { ok: true, caminho: criada.caminho, relato: parede.motivo, parede }
}

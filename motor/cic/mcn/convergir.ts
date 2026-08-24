import { lerCriterios, idsDeCriterio } from '../crv/criterios.ts'
import type { CriterioDoCrivo } from '../crv/criterios.ts'
import { apurar } from '../vto.ts'
import type { Voto, Apuracao } from '../vto.ts'
import { consenso, CONSENSO_MINIMO } from '../rda.ts'
import type { Consenso } from '../rda.ts'
import type { Proposta } from './divergir.ts'

// MCN — a metade CONVERGENTE. Nenhum juiz novo nasce aqui, e isso e o desenho.
//
// O motor ja tem os tres pedacos: o criterio escrito e o CRV, a apuracao e o
// VTO, a medida de acordo e a RDA. Escrever um quarto julgador so para o MCN
// criaria um caminho paralelo com regras proprias — e no dia em que o criterio
// mudasse, metade do motor julgaria pelo novo e o MCN pelo velho, calado.
//
// O que este arquivo faz e so a ligacao: transforma a saida dos criticos em
// Voto[], que e a moeda que VTO e RDA ja sabem contar.
//
// O critico NAO e nenhum dos ramos. Quem gerou nao julga: julgar o proprio
// filho e o ancoramento que a divergencia acabou de gastar dinheiro para
// evitar.

export interface PropostaNumerada {
  readonly n: number
  readonly enquadramento: string
  readonly texto: string
}

export function propostasNumeradas(propostas: readonly Proposta[]): PropostaNumerada[] {
  return propostas.map((p, i) => ({ n: i + 1, enquadramento: p.enquadramento, texto: p.texto }))
}

// O critico vota por LENTE DE CRITERIO, nao por enquadramento. A diferenca
// importa: se os criticos fossem os mesmos enquadramentos que geraram, o placar
// mediria de novo a preferencia de quem propos. Aqui cada criterio escrito do
// CRV vira um eleitor, e o placar passa a medir o que o projeto declarou que
// importa — que e auditavel, porque esta em config/review-criteria.json.
export function promptDoCritico(enunciado: string, lista: readonly PropostaNumerada[], criterio: { id: string; titulo: string; checa: string }): string {
  const listaTexto = lista.map(c => `${c.n}. ${c.texto}`).join('\n')
  return [
    'Voce e o CRITICO. Voce NAO gerou nenhuma destas propostas — julgue sem apego.',
    `Julgue EXCLUSIVAMENTE pelo criterio [${criterio.id}] ${criterio.titulo}: ${criterio.checa}`,
    '',
    `ENUNCIADO: ${enunciado}`,
    '',
    'PROPOSTAS:',
    listaTexto,
    '',
    'Escolha a UNICA proposta que melhor satisfaz ESSE criterio — nao a melhor no geral.',
    'Se nenhuma satisfaz o criterio, escolha 0 e explique: abster e um resultado valido,',
    'e melhor que eleger a menos ruim como se ela servisse.',
    'Responda APENAS um JSON numa linha: {"escolha": 2, "porque": "uma frase curta"}',
  ].join('\n')
}

interface VotoBruto {
  escolha?: number
  porque?: string
}

// Voto ilegivel ou fora da faixa vira ABSTENCAO, nao voto na primeira proposta.
// Um parser que "corrige" para 1 inventaria apoio que o critico nao deu, e o
// placar mentiria para cima justamente onde ninguem conferiria.
export function parseVoto(texto: string, lente: string, lista: readonly PropostaNumerada[]): Voto | null {
  const m = texto.match(/\{[\s\S]*\}/)
  if (!m?.[0]) return null
  try {
    const j = JSON.parse(m[0]) as VotoBruto
    const n = Number(j.escolha)
    if (!Number.isFinite(n) || n < 1) return null
    const alvo = lista.find(c => c.n === n)
    if (!alvo) return null
    return { lente, escolha: alvo.texto, porque: String(j.porque ?? '').replace(/\s+/g, ' ').slice(0, 200) }
  } catch {
    return null
  }
}

export interface Convergencia {
  readonly houveVeredicto: boolean
  readonly motivo: string
  readonly escolhido: PropostaNumerada | null
  readonly apuracao: Apuracao | null
  readonly consenso: Consenso | null
  readonly abstencoes: number
  readonly criteriosUsados: readonly string[]
}

export function convergir(
  votos: readonly Voto[],
  lista: readonly PropostaNumerada[],
  abstencoes: number,
  criteriosUsados: readonly string[],
  minimo: number = CONSENSO_MINIMO,
): Convergencia {
  const base = { abstencoes, criteriosUsados }
  // Votacao vazia nao vira "aprovado por omissao": o VTO ja LANCA nesse caso, e
  // chamar apurar() aqui trocaria uma excecao clara por um veredicto inventado.
  if (!votos.length) {
    return { houveVeredicto: false, motivo: `nenhum criterio votou (${abstencoes} abstencao(oes)) — sem voto nao ha veredicto`, escolhido: null, apuracao: null, consenso: null, ...base }
  }
  const apuracao = apurar(votos)
  const acordo = consenso(votos, minimo)
  if (apuracao.empate) {
    return { houveVeredicto: false, motivo: 'empate entre propostas — o MCN nao desempata sozinho, a divergencia sobe para decisao humana', escolhido: null, apuracao, consenso: acordo, ...base }
  }
  if (!acordo.houve) {
    return {
      houveVeredicto: false,
      motivo: `consenso de ${(acordo.nivel * 100).toFixed(0)}% abaixo do minimo de ${(minimo * 100).toFixed(0)}% — divergiram: ${acordo.divergentes.join(', ')}`,
      escolhido: lista.find(c => c.texto === apuracao.vencedor) ?? null,
      apuracao,
      consenso: acordo,
      ...base,
    }
  }
  return {
    houveVeredicto: true,
    motivo: `${apuracao.votos}/${apuracao.total} criterios convergiram${apuracao.unanime ? ' (unanime)' : ''}`,
    escolhido: lista.find(c => c.texto === apuracao.vencedor) ?? null,
    apuracao,
    consenso: acordo,
    ...base,
  }
}

// Os criticos sao os criterios escritos do CRV. Se o arquivo mudar, a
// convergencia muda junto — que e o ponto de criterio versionado.
export function lentesDeCriterio(c: CriterioDoCrivo = lerCriterios()): Array<{ id: string; titulo: string; checa: string }> {
  return c.criterios.map(x => ({ id: x.id, titulo: x.titulo, checa: x.checa }))
}

export function idsDosCriticos(c: CriterioDoCrivo = lerCriterios()): string[] {
  return idsDeCriterio(c)
}

import { existsSync } from 'node:fs'
import { providerFor, modelFor, effortFor } from '../../tomada/registro.ts'
import { runProvider } from '../../euclides/tesouro/confianca.ts'
import { readProjectRules } from '../../cordel/alicerce/home.ts'
import { readContract } from '../../cordel/bussola/armazenar.ts'
import { ROOT } from '../../cordel/alicerce/config.ts'
import { snapshotDoAmbiente } from '../../cordel/alicerce/ambiente.ts'
import { prepararComandoDeLeitura } from './comando-de-leitura.ts'
import type { ComandoDeLeitura } from './comando-de-leitura.ts'

export interface RespostaDePergunta {
  ok: boolean
  texto: string
  custo: number
  custoMedido: boolean
  provedor: string
}

function contexto(alvo: string): string {
  if (!alvo || !existsSync(alvo)) return ''
  const contrato = readContract(alvo)
  const stack = contrato ? `Stack detectada: ${JSON.stringify(contrato).slice(0, 400)}` : ''
  const regras = readProjectRules(alvo)
  return [stack, regras].filter(Boolean).join('\n')
}

export interface TrocaDeConversa {
  pergunta: string
  resposta: string
}

function historico(trocas: TrocaDeConversa[]): string {
  if (!trocas.length) return ''
  const ultimas = trocas.slice(-3)
  return [
    'CONVERSA ANTERIOR (a mensagem atual pode ser continuacao desta):',
    ...ultimas.map(t => `  humano: ${t.pergunta}\n  voce: ${t.resposta.replace(/\s+/g, ' ').slice(0, 300)}`),
  ].join('\n')
}

// Prompt unico do comando de leitura: a TUI e a API (/v1/ask) montam por aqui,
// e o mesmo /hii-review recebe o mesmo texto nos dois canais. A API nao tem
// conversa, entao passa trocas vazio.
export function promptDoComandoDeLeitura(comando: ComandoDeLeitura, pergunta: string, alvo: string, trocas: TrocaDeConversa[] = []): string {
  return [
    `Voce executa o comando ${comando.comando} sobre este projeto em modo somente leitura. NAO altere nenhum arquivo nem execute operacoes mutaveis.`,
    'Voce le arquivos do projeto e recebe abaixo um retrato do AMBIENTE desta maquina.',
    'Responda em portugues, direto, no formato pedido pelo comando. Sem preambulo.',
    '',
    `COMANDO ${comando.comando}:\n${comando.instrucoes}`,
    comando.contexto ? `CONTEXTO ANEXADO PELO MOTOR:\n${comando.contexto}` : '',
    snapshotDoAmbiente(pergunta),
    historico(trocas),
    contexto(alvo),
    '',
    `PEDIDO: ${pergunta}`,
  ].filter(Boolean).join('\n')
}

export async function responderPergunta(
  pergunta: string,
  alvo: string,
  trocas: TrocaDeConversa[] = [],
  sessionId = '',
): Promise<RespostaDePergunta> {
  const provider = providerFor('verify')
  const comando = await prepararComandoDeLeitura(pergunta, alvo)
  if (comando?.parada) return { ok: !comando.falhou, texto: comando.parada, custo: 0, custoMedido: true, provedor: provider.name }
  const prompt = comando ? promptDoComandoDeLeitura(comando, pergunta, alvo, trocas) : [
    'Voce responde uma PERGUNTA do usuario. NAO altere nenhum arquivo.',
    'Voce le arquivos do projeto e recebe abaixo um retrato do AMBIENTE desta maquina.',
    'Pergunta sobre "tem X instalado" se responde pelo retrato do ambiente, nao pelo codigo do projeto.',
    'Se a resposta estiver no codigo, leia o necessario e cite arquivo e linha.',
    'Se a informacao nao estiver nem no ambiente nem no projeto, diga isso claramente em vez de supor.',
    'Responda em portugues, direto, no maximo 12 linhas. Sem preambulo.',
    '',
    snapshotDoAmbiente(pergunta),
    historico(trocas),
    contexto(alvo),
    '',
    `PERGUNTA: ${pergunta}`,
  ].filter(Boolean).join('\n')

  // /ask continua sem session; uma pergunta dentro de /new usa o mesmo ledger
  // da session HII, e cada chamada de IA vira uma entrada separada nele.
  // Comando de leitura roda no alvo: os caminhos do diff sao relativos a ele.
  const res = await runProvider(sessionId, provider, {
    prompt,
    cwd: comando ? alvo : ROOT,
    dirs: existsSync(alvo) ? [alvo] : [],
    mode: 'readonly',
    useAgents: false,
    model: modelFor('verify'),
    effort: effortFor('verify'),
    timeoutMs: comando ? comando.timeoutMs : 120000,
  }, 'conversa')

  return {
    ok: res.ok,
    texto: (res.text || res.detail || '').trim(),
    custo: res.cost || 0,
    custoMedido: res.costMeasured,
    provedor: provider.name,
  }
}

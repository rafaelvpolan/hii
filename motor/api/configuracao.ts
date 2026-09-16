import { aplicar, ler } from '../tomada/escolha-de-ia.ts'
import { agentRoles, harnessSeExistir, providerFor } from '../tomada/registro.ts'
import { ehEsforco } from '../tomada/preferencias.ts'
import { etagDe } from '../cordel/revisao.ts'
import { campos, ErroApi, texto } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import type { AgentRole } from '../tomada/tipos.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'

export function configuracao(): RespostaApi {
  const preferencias = ler()
  return resposta(200, { versao: 1, preferencias, aplicacao: 'proximos despachos; execucoes em voo mantem snapshot' }, etagDe(preferencias))
}
export function configurar(b: Objeto, esperado: string): RespostaApi {
  campos(b, ['versao', 'papel', 'provider', 'model', 'effort', 'modo', 'gauntlet'])
  if (b.versao !== 1) throw new ErroApi(400, 'versao_invalida', 'versao: 1 obrigatoria')
  if (!esperado) throw new ErroApi(428, 'revisao_obrigatoria', 'envie If-Match')
  const papel = texto(b, 'papel') as AgentRole
  if (!agentRoles().includes(papel)) throw new ErroApi(400, 'papel_invalido', 'papel desconhecido')
  const provider = b.provider === undefined ? undefined : texto(b, 'provider')
  const h = provider ? harnessSeExistir(provider) : providerFor(papel)
  if (!h) throw new ErroApi(400, 'provedor_invalido', 'provedor nao registrado')
  const caps = h.capabilities()
  if (papel === 'implement' && !h.agentic) throw new ErroApi(400, 'capacidade_insuficiente', 'provedor nao executa edicao de arquivos')
  if ((papel === 'gate' || papel === 'verify') && (!caps.isolatesReadonly || !caps.emitsStructuredJson)) throw new ErroApi(400, 'capacidade_insuficiente', 'verificacao exige leitura isolada e JSON estruturado')
  const model = b.model === undefined ? undefined : b.model === '' ? '' : texto(b, 'model', false, 200)
  const effort = b.effort === undefined ? undefined : texto(b, 'effort')
  if (effort && (!ehEsforco(effort) || !h.capabilities().acceptsEffort)) throw new ErroApi(400, 'esforco_invalido', 'esforco nao suportado')
  const modo = b.modo === undefined ? undefined : texto(b, 'modo')
  if (modo && !h.modos.modos.includes(modo)) throw new ErroApi(400, 'modo_invalido', 'modo nao suportado')
  if (b.gauntlet !== undefined && (typeof b.gauntlet !== 'boolean' || papel !== 'gate')) throw new ErroApi(400, 'gauntlet_invalido', 'gauntlet booleano pertence ao gate')
  const r = aplicar({ papeis: [papel], provider, model, effort, modo, gauntlet: typeof b.gauntlet === 'boolean' ? b.gauntlet : undefined }, esperado)
  if (!r.ok) throw new ErroApi(r.mensagem === 'revisao_alterada' ? 412 : 409, 'configuracao_recusada', r.mensagem)
  return configuracao()
}

import { ACOES } from './contrato.ts'
import { STATUSES } from '../cordel/tipos.ts'
import { TIPOS_DA_PONTE } from '../euclides/ponte-eventos.ts'

const str = { type: 'string' }
const id = { type: 'string', pattern: '^\\d{3,12}$' }
const idParam = { name: 'id', in: 'path', required: true, schema: id }
const chave = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' } }
const revisao = { name: 'If-Match', in: 'header', required: true, schema: str }
const repo = { name: 'repo', in: 'query', schema: str }
const ref = (nome: string): { $ref: string } => ({ $ref: `#/components/schemas/${nome}` })
const json = (schema: object): object => ({ 'application/json': { schema } })
const ok = (schema: object): object => ({ description: 'Resposta do motor', content: json(schema), headers: { ETag: { schema: str, description: 'Revisao para If-Match quando aplicavel' } } })
const erro = { description: 'Erro de autenticacao, validacao, revisao, conflito ou operacao', content: json(ref('Erro')) }
function get(operationId: string, schema: object, parameters: object[] = []): object {
  return { operationId, parameters, responses: { '200': ok(schema), default: erro } }
}
function post(operationId: string, entrada: object, saida: object, code = '200', params: object[] = []): object {
  return { operationId, parameters: [chave, ...params], requestBody: { required: true, content: json(entrada) }, responses: { [code]: ok(saida), default: erro } }
}
function objeto(properties: object, required: string[] = []): object {
  return { type: 'object', additionalProperties: false, properties, required }
}

export const openapi = {
  openapi: '3.1.1',
  info: { title: 'HII Motor API', version: '1.0.0', description: 'API single-user para o backend Hicode. O motor e a autoridade do estado. Nao inicia o daemon nem faz merge.' },
  security: [{ bearer: [] }],
  paths: {
    '/v1/capacidades': { get: get('capacidades', ref('Capacidades')) },
    '/v1/openapi.json': { get: get('contrato', { type: 'object' }) },
    '/v1/projetos': { get: get('projetos', objeto({ projetos: { type: 'array', items: objeto({ nome: str }, ['nome']) } }, ['projetos'])) },
    '/v1/provedores': { get: get('provedores', { type: 'object', required: ['provedores'], properties: { provedores: { type: 'array', items: { type: 'object' } } } }) },
    '/v1/estado': { get: get('estado', ref('Estado'), [repo]) },
    '/v1/recursos': { get: get('recursos', { type: 'object' }, [{ ...repo, required: true }]) },
    '/v1/sessoes': {
      get: get('sessoes', objeto({ sessoes: { type: 'array', items: ref('Sessao') } }, ['sessoes']), [repo]),
      post: post('novaSessao', objeto({ repo: str, titulo: { ...str, maxLength: 500 } }, ['repo', 'titulo']), ref('Sessao'), '201'),
    },
    '/v1/sessoes/{id}': { get: get('sessao', ref('Sessao'), [idParam]) },
    '/v1/sessoes/{id}/pedidos': { post: post('novoPedido', ref('Pedido'), ref('PedidoCriado'), '201', [idParam]) },
    '/v1/sessoes/{id}/fechar': { post: post('fecharSessao', objeto({}), ref('Sessao'), '200', [idParam, revisao]) },
    '/v1/tarefas/{id}': { get: get('tarefa', ref('Tarefa'), [idParam]) },
    '/v1/tarefas/{id}/acoes': { post: post('agir', objeto({ acao: { enum: ACOES }, texto: str }, ['acao']), { type: 'object' }, '200', [idParam, revisao]) },
    '/v1/tarefas/{id}/log': { get: get('log', ref('Log'), [idParam, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } }]) },
    '/v1/tarefas/{id}/plano': { get: get('plano', { type: 'object', required: ['plano', 'evidencias', 'atualidadeVerificada'], properties: { plano: { type: ['object', 'null'] }, evidencias: { type: ['object', 'null'] }, atualidadeVerificada: { const: false } } }, [idParam]) },
    '/v1/eventos': { get: {
      operationId: 'eventos', parameters: [{ name: 'Last-Event-ID', in: 'header', schema: str }],
      description: 'SSE com cursor duravel. Sem cursor inicia no presente. 409 exige snapshot e reconexao. Duplicatas devem ser deduplicadas por id. Eventos pronto/reset sao de controle.',
      responses: { '200': { description: 'Stream SSE', content: { 'text/event-stream': { schema: { type: 'string' } } } }, default: erro },
    } },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Erro: objeto({ erro: objeto({ codigo: str, mensagem: str }, ['codigo', 'mensagem']) }, ['erro']),
      Capacidades: {
        type: 'object', required: ['protocolo', 'versao', 'statuses', 'acoes', 'eventos', 'modos'],
        properties: { protocolo: { const: 'hii-http' }, versao: { const: 1 }, statuses: { type: 'array', items: { enum: STATUSES } }, acoes: { type: 'array', items: { enum: ACOES } }, eventos: { type: 'array', items: { enum: TIPOS_DA_PONTE } }, modos: { type: 'array', items: { enum: ['gateway', 'orquestrador'] } } },
      },
      Sessao: {
        type: 'object', required: ['versao', 'id', 'repo', 'titulo', 'revisao', 'estado', 'mensagens', 'execucoes', 'subsessoes'],
        properties: { versao: { const: 1 }, id, repo: str, titulo: str, revisao: { type: 'integer' }, estado: { enum: ['aberta', 'fechada'] },
          mensagens: { type: 'array', items: ref('Mensagem') }, execucoes: { type: 'array', items: ref('Execucao') }, subsessoes: { type: 'array', items: ref('Subsessao') } },
      },
      Mensagem: objeto({ id: str, autor: { enum: ['humano', 'ia'] }, texto: str, execucao: str, provedor: str, modelo: str, instante: str }, ['id', 'autor', 'texto', 'execucao', 'provedor', 'modelo', 'instante']),
      Execucao: objeto({ id, modo: { enum: ['gateway', 'passivo'] }, criadaEm: str }, ['id', 'modo', 'criadaEm']),
      Subsessao: objeto({ id: str, execucao: id, provedor: str, modelo: str, papel: str, nativa: { type: ['string', 'null'] }, inicio: str, fim: str, estado: { enum: ['executando', 'concluida', 'falhou', 'interrompida'] } }, ['id', 'execucao', 'provedor', 'modelo', 'papel', 'nativa', 'inicio', 'fim', 'estado']),
      Pedido: {
        oneOf: [
          objeto({ modo: { enum: ['gateway', 'orquestrador'] }, texto: { ...str, minLength: 1, maxLength: 1048576 } }, ['modo', 'texto']),
          objeto({ modo: { const: 'orquestrador' }, spec: objeto({ nome: { ...str, pattern: '^[^/\\\\]+\\.spec(?:\\.md)?$', maxLength: 200 }, conteudo: { ...str, minLength: 1, maxLength: 1048576 } }, ['nome', 'conteudo']) }, ['modo', 'spec']),
        ],
        description: 'Limites de texto tambem aplicados em bytes UTF-8. Spec enviado por conteudo; nunca como caminho do servidor.',
      },
      PedidoCriado: objeto({ id, sessao: id, modo: { enum: ['gateway', 'orquestrador'] }, status: { enum: STATUSES }, enfileirada: { type: 'boolean' }, mensagem: str }, ['id', 'sessao', 'modo', 'status', 'enfileirada', 'mensagem']),
      Tarefa: objeto({ etag: str, campos: { type: 'object', additionalProperties: str }, objetivo: str }, ['etag', 'campos', 'objetivo']),
      Estado: { type: 'object', required: ['versao', 'cursor', 'tarefas', 'conversas', 'orquestrador'], properties: { versao: { const: 1 }, cursor: str, tarefas: { type: 'array', items: { type: 'object' } }, conversas: { type: 'array', items: ref('Sessao') }, orquestrador: { type: 'object' } } },
      Evento: objeto({ id: str, versao: { const: 1 }, tipo: { enum: TIPOS_DA_PONTE }, instante: str, tarefa: str, sessao: str, dados: { type: 'object', additionalProperties: str } }, ['id', 'versao', 'tipo', 'instante', 'tarefa', 'sessao', 'dados']),
      Log: objeto({ texto: str, proximo: { type: 'integer', minimum: 0 }, reset: { type: 'boolean' } }, ['texto', 'proximo', 'reset']),
    },
  },
}

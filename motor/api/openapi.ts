import { ACOES } from './contrato.ts'
import { STATUSES } from '../cordel/tipos.ts'
import { TIPOS_DA_PONTE } from '../euclides/ponte-eventos.ts'

const str = { type: 'string' }
const id = { type: 'string', pattern: '^\\d{3,12}$' }
const idParam = { name: 'id', in: 'path', required: true, schema: id }
const chave = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,128}$' } }
const revisao = { name: 'If-Match', in: 'header', required: true, schema: str }
const repo = { name: 'repo', in: 'query', schema: str }
const escopo = [repo, { name: 'sessao', in: 'query', schema: id }, { name: 'execucao', in: 'query', schema: id }]
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
  info: { title: 'HII Motor API', version: '1.2.0', description: 'API single-user para o backend Hicode. Extensao de observabilidade v1 independente da ponte legada. O motor e a autoridade do estado. Partida do daemon somente por POST administrativo com opt-in explicito. Nao faz merge.' },
  security: [{ bearer: [] }],
  paths: {
    '/v1/diagnostico': { get: get('diagnosticarMotor', { type: 'object', description: 'Diagnostico v1 sem inferencia, somente API administrativa. Checks com estado, escopo, duracao e horario; timeout global de 30 segundos.' }) },
    '/v1/recuperacoes/previa': { post: { ...post('previaRecuperacao', ref('PacoteRecuperacao'), { type: 'object' }), parameters: [] } },
    '/v1/recuperacoes/importar': { post: post('importarRecuperacao', objeto({ pacote: ref('PacoteRecuperacao'), hash: str }, ['pacote', 'hash']), { type: 'object' }) },
    '/v1/tarefas/{id}/recuperacao': { get: get('diagnosticarRecuperacao', { type: 'object' }, [idParam]) },
    '/v1/tarefas/{id}/preparar-recuperacao': { post: post('prepararRecuperacao', objeto({ fingerprint: str }, ['fingerprint']), { type: 'object' }, '200', [idParam, revisao]) },
    '/v1/tarefas/{id}/snapshots': { get: get('snapshotsExecucao', { type: 'object' }, [idParam]) },
    '/v1/tarefas/{id}/restaurar-configuracao': { post: post('restaurarConfiguracao', objeto({ hash: str }, ['hash']), { type: 'object' }, '200', [idParam, revisao]) },
    '/v1/motor/iniciar': { post: { operationId: 'iniciarMotor', description: 'Opt-in HII_API_AUTOSTART=1 e API administrativa. Sem argumentos de processo. Serializa e limita tentativas; nao retoma cards pausados.', requestBody: { required: true, content: json(objeto({})) }, responses: { '200': ok({ type: 'object' }), default: erro } } },
    '/v1/motor/status': { get: get('estadoMotor', objeto({ protocolo: { const: 1 }, estado: { enum: ['ligado', 'desligado', 'degradado', 'desconhecido'] }, versao: str, versaoEmExecucao: { type: ['string', 'null'] }, fila: str, consultadoEm: str, motivo: str }, ['protocolo', 'estado', 'versao', 'versaoEmExecucao', 'fila', 'consultadoEm', 'motivo'])) },
    '/v1/observabilidade/snapshot': { get: get('snapshotObservabilidade', ref('SnapshotObservabilidade'), [...escopo, { name: 'depois', in: 'query', schema: str }, { name: 'limite', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }]) },
    '/v1/observabilidade/recursos': { get: get('catalogoObservabilidade', { type: 'object', properties: { recursos: { type: 'array', items: ref('RecursoObservavel') } } }, [repo]) },
    '/v1/observabilidade/eventos': { get: { operationId: 'eventosObservabilidade', parameters: [...escopo, { name: 'Last-Event-ID', in: 'header', schema: str }], description: 'SSE extensao v1: activity/output/cursor/reset. 409 exige reconstruir snapshot. Filtros nao concedem autorizacao.', responses: { '200': { description: 'SSE', content: { 'text/event-stream': { schema: str } } }, default: erro } } },
    '/v1/ask': { post: post('perguntar', objeto({ repo: str, pergunta: { ...str, maxLength: 16000 } }, ['repo', 'pergunta']), ref('Consulta'), '202') },
    '/v1/consultas/{consultaId}': { get: get('consultarResposta', ref('Consulta'), [{ name: 'consultaId', in: 'path', required: true, schema: { ...str, format: 'uuid' } }]) },
    '/v1/configuracao': { get: get('configuracao', { type: 'object' }), post: post('configurar', objeto({ versao: { const: 1 }, papel: { enum: ['implement', 'verify', 'gate', 'step'] }, provider: str, model: str, effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] }, modo: str, gauntlet: { type: 'boolean' }, autoReview: { type: 'boolean', description: 'Executa revisores especializados e usa seus pareceres como gate. Desligado ou ausente deixa a aprovacao do PR para revisao humana.' }, revisao: ref('PoliticaDeRevisao') }, ['versao', 'papel']), { type: 'object' }, '200', [revisao]) },
    '/v1/tarefas/{id}/avaliacao': { get: get('avaliarExecucao', ref('AvaliacaoDeExecucao'), [idParam]) },
    '/v1/tarefas/{id}/artefatos': { get: get('listarArtefatos', { type: 'object', properties: { artefatos: { type: 'array', items: ref('Artefato') } } }, [idParam]) },
    '/v1/tarefas/{id}/historico': { get: get('historicoDaExecucao', { type: 'object' }, [idParam, { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }]) },
    '/v1/tarefas/{id}/perguntas': { get: get('perguntas', { type: 'object', properties: { perguntaId: { type: ['string', 'null'] }, pendencia: { type: ['object', 'null'] } } }, [idParam]) },
    '/v1/tarefas/{id}/respostas': { post: post('responderPergunta', objeto({ perguntaId: str, texto: str }, ['perguntaId', 'texto']), { type: 'object' }, '200', [idParam, revisao]) },
    '/v1/artefatos/{artefatoId}': { get: get('lerArtefato', ref('Artefato'), [{ name: 'artefatoId', in: 'path', required: true, schema: { ...str, pattern: '^[a-f0-9]{64}$' } }]) },
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
    '/v1/tarefas/{id}/plano': { get: get('plano', { type: 'object', required: ['plano', 'evidencias', 'atualidadeVerificada'], properties: { plano: { type: ['object', 'null'] }, evidencias: { type: ['object', 'null'] }, atualidadeVerificada: { const: false } } }, [idParam]), post: post('revisarPlano', objeto({ plano: { type: 'object' }, revisaoEsperada: { type: 'integer', minimum: 0 } }, ['plano', 'revisaoEsperada']), { type: 'object' }, '200', [idParam, revisao]) },
    '/v1/eventos': { get: {
      operationId: 'eventos', parameters: [{ name: 'Last-Event-ID', in: 'header', schema: str }],
      description: 'SSE com cursor duravel. Sem cursor inicia no presente. 409 exige snapshot e reconexao. Duplicatas devem ser deduplicadas por id. Eventos pronto/reset sao de controle.',
      responses: { '200': { description: 'Stream SSE', content: { 'text/event-stream': { schema: { type: 'string' } } } }, default: erro },
    } },
  },
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      PoliticaDeRevisao: objeto({ versao: { const: 1 }, revisao: { type: 'integer', minimum: 1 },
        revisores: { type: 'array', minItems: 1, maxItems: 8, items: objeto({ papel: str, provedor: str, modelo: str, dominio: str,
          obrigatorio: { type: 'boolean' }, ativo: { type: 'boolean' }, riscos: { type: 'array', items: { enum: ['low', 'high'] } },
          extensoes: { type: 'array', items: str } }, ['papel', 'provedor', 'dominio', 'obrigatorio', 'ativo']) } }, ['versao', 'revisao', 'revisores']),
      PacoteRecuperacao: objeto({ versao: { const: 1 }, origem: { ...str, pattern: '^[a-f0-9]{64}$' }, arquivo: str, repo: str,
        documento: { ...str, maxLength: 1048576 }, anexos: { type: 'array', maxItems: 64, items: objeto({ nome: str, conteudo: { ...str, contentEncoding: 'base64' }, sha256: str }, ['nome', 'conteudo', 'sha256']) } },
      ['versao', 'origem', 'arquivo', 'repo', 'documento', 'anexos']),
      AvaliacaoDeExecucao: objeto({
        entrega: objeto({ head: str, tree: str, pr: str, merge: { type: ['string', 'null'] } }, ['head', 'tree', 'pr', 'merge']),
        versao: { const: 1 }, execucao: id, repo: str, sessao: str, status: str, modo: str,
        plano: { oneOf: [{ type: 'null' }, objeto({ revisao: { type: 'integer', minimum: 1 }, hash: str, produto: str, planejamento: str, origemRevisao: { type: 'integer', minimum: 0 }, tecnicoHash: str }, ['revisao', 'hash', 'produto', 'planejamento', 'origemRevisao', 'tecnicoHash'])] },
        atualidade: { enum: ['ausente', 'atual', 'desatualizada', 'indisponivel', 'inconsistente'] },
        motivo: str, consultadaEm: { ...str, format: 'date-time' }, evidenciaEm: { type: ['string', 'null'] }, tentativa: { type: ['string', 'null'] }, criteriosAprovados: { type: 'boolean' },
        criterios: { type: 'array', items: objeto({ id: str, descricao: str, obrigatorio: { type: 'boolean' },
          estado: { enum: ['aprovado', 'reprovado', 'inconclusivo', 'nao-aplicavel'] },
          resultadoRegistrado: { enum: ['aprovado', 'reprovado', 'inconclusivo', 'nao-aplicavel', null] },
          comando: { type: 'array', items: str }, exitCode: { type: ['integer', 'null'] }, timeout: { type: 'boolean' },
          duracaoMs: { type: ['number', 'null'], minimum: 0 }, saida: { ...str, maxLength: 32000 },
        }, ['id', 'descricao', 'obrigatorio', 'estado', 'resultadoRegistrado', 'comando', 'exitCode', 'timeout', 'duracaoMs', 'saida']) },
      }, ['versao', 'execucao', 'repo', 'sessao', 'status', 'modo', 'plano', 'atualidade', 'motivo', 'consultadaEm', 'evidenciaEm', 'tentativa', 'criteriosAprovados', 'criterios']),
      RecursoObservavel: objeto({ id: str, namespace: str, nome: str, tipo: { enum: ['orchestrator', 'agent', 'harness', 'skill', 'loop', 'validation'] }, origem: str, versao: { type: ['string', 'null'] }, capacidades: { type: 'array', items: str }, observabilidade: { enum: ['instrumented', 'partial', 'unobservable'] } }, ['id', 'namespace', 'nome', 'tipo', 'origem', 'versao', 'capacidades', 'observabilidade']),
      Medida: objeto({ valor: { type: ['number', 'null'] }, fonte: str, instante: { ...str, format: 'date-time' }, qualidade: { enum: ['measured', 'unknown', 'lower_bound'] } }, ['valor', 'fonte', 'instante', 'qualidade']),
      Saida: objeto({ sequencia: { type: 'integer', minimum: 1 }, canal: { enum: ['stdout', 'stderr', 'assistant', 'error'] }, texto: str, instante: str }, ['sequencia', 'canal', 'texto', 'instante']),
      Atividade: { type: 'object', required: ['id', 'pai', 'recurso', 'repo', 'sessao', 'execucao', 'revisao', 'estado', 'metricas', 'saida'], properties: { id: str, pai: { type: ['string', 'null'] }, recurso: ref('RecursoObservavel'), repo: str, sessao: str, execucao: str, revisao: { type: 'integer', minimum: 1 }, estado: { enum: ['queued', 'running', 'waiting_human', 'waiting_retry', 'blocked', 'succeeded', 'failed', 'cancelled', 'skipped', 'unknown'] }, metricas: objeto({ custoUsd: ref('Medida'), tokens: ref('Medida') }), saida: { type: 'array', items: ref('Saida') }, detalhes: { type: 'object' }, atualizado: str, heartbeat: { type: ['string', 'null'] }, fim: { type: ['string', 'null'] }, truncado: { type: 'boolean' } } },
      SnapshotObservabilidade: objeto({ versao: { const: 1 }, cursor: str, atividades: { type: 'array', items: ref('Atividade') }, degradado: { type: 'boolean' }, motivo: { type: ['string', 'null'] }, proxima: { type: ['string', 'null'] }, retencao: { type: 'object' } }, ['versao', 'cursor', 'atividades', 'degradado', 'motivo', 'proxima', 'retencao']),
      Consulta: { type: 'object', required: ['versao', 'id', 'repo', 'estado', 'atividade', 'resposta', 'custoUsd'], properties: { versao: { const: 1 }, id: { ...str, format: 'uuid' }, repo: str, estado: { enum: ['running', 'succeeded', 'failed', 'unknown'] }, atividade: str, resposta: str, custoUsd: { type: ['number', 'null'] } } },
      Artefato: { type: 'object', required: ['id', 'repo', 'execucao', 'nome', 'tipo', 'tamanho', 'sha256', 'expira'], properties: { id: str, repo: str, execucao: str, sessao: str, nome: str, tipo: { enum: ['text/plain', 'text/markdown', 'application/json'] }, tamanho: { type: 'integer', maximum: 262144 }, sha256: str, expira: { ...str, format: 'date-time' }, conteudo: str } },
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
          objeto({ modo: { const: 'orquestrador' }, dependencias: { type: 'array', maxItems: 8, items: objeto({ produto: str, execucao: id, tecnicoHash: { ...str, pattern: '^[a-f0-9]{64}$' } }, ['produto', 'execucao', 'tecnicoHash']) }, tecnico: { ...str, minLength: 1, maxLength: 200000, description: 'JSON tecnico v1 integral; ate 500 linhas, incluindo metadados e linhas vazias.' } }, ['modo', 'tecnico']),
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

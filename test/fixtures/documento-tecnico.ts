import type { DocumentoTecnico } from '../../motor/oswaldo/orquestracao/tecnico.ts'
export function documentoTecnico(): DocumentoTecnico {
  return { versao: 1, id: 'tecnico-triagem', repo: 'org/app', produtoId: 'triagem',
    origem: { planejamento: 'principal', revisao: 3 }, titulo: 'Triagem de entradas',
    solucao: 'Registrar categoria da entrada', contexto: 'Equipe recebe entradas sem categoria',
    escopo: 'Classificar entradas novas', exclusoes: 'Nao migrar entradas antigas', referencias: [],
    dependencias: [], riscos: 'Categoria incorreta exige reversao', risco: 'low',
    criterios: [{ id: 'classificacao', descricao: 'Entrada nova recebe categoria', resultado: 'Categoria correta aparece na consulta',
      verificacao: 'Executar teste de entrada conhecida', verificador: 'test', obrigatorio: true }],
    microtasks: [{ id: 'implementar', titulo: 'Implementar classificacao', instrucao: 'Classificar a entrada conforme sua origem',
      saida: 'Codigo e teste da classificacao', agente: 'limpio', dependeDe: [], arquivos: ['src/triagem.ts'], criterios: ['classificacao'] }],
    operacao: { e2e: 'Enviar entrada e conferir categoria', observabilidade: 'Conferir metrica de classificacao',
      logging: 'Registrar categoria sem dados pessoais', flags: 'Ativar apenas para o grupo piloto',
      ativacao: 'Habilitar depois da revisao humana', sucesso: 'Todas as entradas classificadas corretamente',
      interrupcao: 'Parar em qualquer classificacao incorreta', reversao: 'Reverter o commit e desabilitar a flag' } }
}

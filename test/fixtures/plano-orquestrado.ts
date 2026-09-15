import type { PlanoDeExecucao } from '../../motor/oswaldo/orquestracao/contrato.ts'

export function planoOrquestrado(): PlanoDeExecucao {
  return {
    versao: 1, id: '002', repo: 'org/app', sessaoId: '001', objetivo: 'Validar a mudanca', risco: 'low',
    criterios: [{ id: 'teste', descricao: 'Processo de teste termina com sucesso', obrigatorio: true,
      comando: { binario: 'true', argumentos: [], diretorio: '.', timeoutMs: 1000 } }],
    microtasks: ['A', 'B', 'C', 'D'].map(id => ({ id, titulo: id, instrucao: `implemente ${id}`, agente: 'limpio',
      dependeDe: id === 'A' ? [] : id === 'D' ? ['B', 'C'] : ['A'], arquivos: [`${id}.txt`], criterios: ['teste'] })),
    rollout: { ativacao: 'habilitar por projeto', sucesso: 'teste aprovado', interrupcao: 'teste falhou', reversao: 'desabilitar por projeto' },
  }
}

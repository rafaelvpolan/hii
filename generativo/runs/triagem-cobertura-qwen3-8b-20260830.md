motor/agentes/tarsila/design.ts | B | design estrutural, não contém lógica complexa  
motor/ciclo/crivo/portoes-de-fecho.ts | B | controla fluxo, orchestrador central  
motor/ciclo/reprise/reparadores/laravel-php.ts | A | lógica de reparo específica (regras de negócio)  
motor/euclides/sessao.ts | B | gerencia estado, fio condutor de sessão  
motor/euclides/tesouro/custo.ts | A | cálculos financeiros, regras de negócio  
motor/mirante/cli/comandos.ts | B | comandos CLI, orchestrador de ações  
motor/mirante/cli/saida.ts | C | I/O de saída (console), contrato de renderização  
motor/mirante/cli/situacao-cli.ts | B | estado da CLI, fio condutor de contexto  
motor/mirante/render/config/tipos.ts | B | tipos estruturais, não lógica complexa  
motor/mirante/render/disco.ts | C | I/O de disco, contrato de renderização  
motor/mirante/watch.ts | C | monitoramento de I/O (arquivos), contrato de observação  
motor/quilombo/alfandega/confianca.ts | A | lógica de confiança (regras de negócio)  
motor/quilombo/alfandega/ipv4.ts | C | I/O de rede (IPv4), contrato de endereçamento  
motor/quilombo/cartorio/responder-pergunta.ts | A | lógica de resposta (regras de negócio)  
motor/tomada/confianca.ts | A | lógica de confiança (regras de negócio)  
motor/tomada/harness/claude-stream.ts | C | I/O com serviço externo (Claude), contrato de integração  
motor/tomada/ponte/tarefas/tipos.ts | B | tipos estruturais, não lógica complexa  
motor/tomada/sonda.ts | C | I/O de inspeção (sistema), contrato de verificação
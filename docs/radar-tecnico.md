# Radar tecnico semanal integrado ao HII

Este documento e o contexto de integracao para a automacao `HII — Radar tecnico semanal`.
Repositorio: https://github.com/rafaelvpolan/hii.
Implementacao inicial: https://github.com/rafaelvpolan/hii/pull/72.
Agenda estabelecida: sexta-feira, 08:00, America/Sao_Paulo.

## Contexto de cada execucao

1. Consulte a main atual, os PRs abertos e as issues do repositorio. Um PR aberto e uma proposta, nao uma funcionalidade integrada. Registre a revisao consultada e limites de acesso.
2. Leia AGENTS.md e docs/arquitetura-adaptativa.md na revisao consultada. Confirme no codigo as capacidades relevantes antes de sugerir mudancas.
3. Selecione ate 10 publicacoes relevantes, priorizando papers cientificos/arXiv, repositorios oficiais, implementacoes e benchmarks sobre roteamento entre modelos, loops de agentes, orquestracao em grafo, MCP e skills.
4. Verifique existencia, autores, data, links e resultados nas fontes primarias. Diferencie resultado publicado de hipotese para o HII. Nao trate percentuais externos como ganhos medidos neste motor.
5. Compare cada ideia com a main e os PRs abertos. Indique o que ja existe, o que esta em revisao e a lacuna concreta; evite propor novamente a mesma implementacao.
6. Para ideias que valham testar, indique o componente real, um experimento isolado, criterios observaveis e limites. Preserve escolhas humanas, gates, custo desconhecido e parada humana.

## Formato do resultado

Abra com a revisao do HII consultada e o estado do PR #72. Para cada descoberta,
registre fonte/data, mudanca, evidencia e limitacao, relevancia para o codigo
atual e experimento proposto. Termine com ate tres prioridades tecnicas e seus
criterios de sucesso. Se nao houver evidencia nova suficiente, informe isso
sem preencher a selecao com publicacoes nao verificadas.

O radar entrega pesquisa e propostas. Implementar codigo e publicar novas
branches/PRs requer um pedido de trabalho; a automacao de pesquisa nao amplia
por si so a autorizacao de escrita. Merge permanece humano. Use fixtures, nao
a fila ativa nem reinicio do daemon, para validar ideias.

## Prompt para a automacao existente

Toda sexta-feira as 08:00 (America/Sao_Paulo), produza uma selecao curta e tecnica
de ate 10 novos papers, relatorios e analises uteis ao HII. Use
https://github.com/rafaelvpolan/hii como repositorio de referencia e siga o guia
docs/radar-tecnico.md da main, quando disponivel. Enquanto o PR #72 estiver
aberto, consulte tambem o guia e a arquitetura adaptativa dessa branch e marque
essas capacidades como em revisao. Priorize roteamento entre modelos, loops de
agentes, orquestracao em grafo, MCP e skills; use fontes primarias verificadas,
incluindo papers, codigo oficial e benchmarks. Resuma o que mudou, por que
importa, o que ja existe no HII e quais ideias valem testar, com componente,
criterio de sucesso e limitacoes. Preserve a agenda e a finalidade de pesquisa
da automacao existente. Nao crie uma segunda automacao para o mesmo radar.

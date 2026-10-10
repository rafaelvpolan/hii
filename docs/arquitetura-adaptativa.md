# Arquitetura adaptativa: primeira implementacao

Base: `9da49dcd0194af265574bacf8b87b24f0426cb72` (main, 09/10/2026).
Esta implementacao integra as ideias de engenharia do radar ao motor existente.
Nao depende da exatidao das publicacoes ou dos percentuais citados no radar.

## Cobertura

| Componente | Estado | Contrato observavel |
| --- | --- | --- |
| Estimativa de dificuldade | Novo, heuristico | Risco alto, seguranca e feedback de reparo elevam para complexa; nunca reduzem tiers ou gates |
| Roteamento por etapa | Novo, opt-in | Implementacao, polimento, avaliacao, verificacao visual e crivo consultam uma politica antes da chamada |
| Orquestracao em grafo | Ja existente | Dependencias, ondas, worktrees e integracao continuam no executor de planos |
| Monitor de trajetoria | Novo, observacao | Eventos de ferramentas de Claude, Codex e Ollama alimentam `trajectoryHealth` |
| Frequencia adaptativa | Nova, observacao | Inspecao a cada 5s com repeticao; 30s com ferramentas distintas; 15s sem eventos |
| Resolucao de skills | Existente, reforcada | ID duplicado na mesma origem ou selecao e recusado; precedencia nativa continua vigente |
| Ciclo de vida de skills | Novo, declarativo | `trial`, `active`, `stable`, `retired`; ausencia significa stable |
| Verificacao independente | Ja existente | Evidencia executavel obrigatoria; sucesso textual nao libera sucessoras |
| Cache seguro | Ja existente | Checkpoints exigem fingerprint atual e revalidacao de evidencias antes de pular trabalho |
| MCP | Ja existente | Preservado protocolo/adaptadores atuais; roteamento de acao externa exige capacidade MCP |
| Revisao entre provedores | Ja existente | Politica do crivo governa revisores; roteamento nao troca atribuicoes explicitas |

## Ativar o roteamento

Prepare uma copia de `config/step-routing.example.json` com sua ordem preferida
por papel e dificuldade. Passe seu caminho absoluto em
`HII_STEP_ROUTING_CONFIG` ao iniciar o processo do HII pelo procedimento habitual.
Sem a variavel, a escolha dos provedores mantem o comportamento anterior.
Nenhum daemon foi iniciado ou reiniciado para construir esta mudanca.

As ordens do exemplo sao ilustrativas, nao um ranking aferido de qualidade,
custo ou velocidade. Use apenas provedores registrados. Qwen ainda nao possui
adaptador neste checkout; nao foi inventado um adaptador para preencher o radar.

O candidato precisa estar autenticado, com cota disponivel e capacidades
adequadas: escrita para implement/step; isolamento de leitura e JSON para
verify/gate; visao quando solicitada; MCP para acoes externas; execucao local
quando a politica do motor exigir. Sem candidato apto, preserva a escolha
anterior e o gate de capacidades ainda verifica a chamada.

Overrides do card, atribuicoes `ia` por microtask e preferencias humanas de
provedor/modelo prevalecem. O roteador nao altera `ia.json`, o plano aprovado
ou o provider_override persistido. Configuracao invalida e recusada.
Escolhas automaticas geram `step_route_selected` no diario do card. O ledger
existente continua registrando provedor/modelo efetivos e custo conhecido ou
desconhecido. Nao ha suposicao de que assinatura de CLI equivalha a custo zero.

## Supervisao em observacao

`trajectoryHealth` aparece nos detalhes da atividade do harness, incluindo
ferramentas concluidas, repeticoes consecutivas, recomendacao e intervalo da
proxima inspecao. Seis conclusoes consecutivas da mesma ferramenta produzem
`advisory`; uma ferramenta diferente reduz a frequencia da inspecao.

Claude correlaciona tool_use/tool_result pelo ID. Codex publica apenas o tipo
publico da operacao (por exemplo, command_execution). Argumentos, comandos,
conteudo de arquivos e resultados nao sao copiados para eventos semanticos.
Ollama ja fornece eventos de ferramentas. Harnesses sem esses eventos ficam
`sem_evidencia`, nao saudaveis por omissao.

Repeticao e sinal de inspeccao, nao prova de loop. O monitor nao interrompe,
troca estrategia ou dispara chamadas adicionais de LLM. `replacement` requer
uma futura politica calibrada com progresso de testes e workspace, suporte de
cancelamento e reconciliacao de efeitos. Parada humana e contabilizacao de
custo permanecem com os donos atuais.

## Skills

O frontmatter aceita `estado: trial|active|stable|retired`. Skills antigas
continuam estaveis. Skills retired nunca entram na selecao; trial so entra em
chamadores que passam `experimentarSkills: true` ao contexto, para fixtures ou
pilotos isolados. O fluxo de producao nao habilita esse flag automaticamente.
active/stable seguem os gatilhos existentes. O estado selecionado e registrado
na observabilidade do carregamento.

Promocao, aposentadoria e alteracao de instrucoes continuam revisaveis em Git;
nenhum resultado de LLM promove ou reescreve automaticamente uma skill.
O digest das instrucoes ja registrado permite relacionar falhas com versoes.
A deteccao de duplicidade trata identidade, nao equivalencia semantica entre
instrucoes de IDs diferentes.

## Validacao e experimento futuro

Fixtures cobrem roteamento, requisitos de capacidades, risco/reparo,
configuracao ambigua, estados de skills, conflitos de IDs e eventos publicos
dos CLIs falsos. Os testes existentes de executarPlano comprovam que sucesso
declarado com teste falho nao libera sucessoras, que custo desconhecido
bloqueia novos despachos e que parada humana prevalece.

Para comparar qualidade/custo, use 40 tarefas reais do projeto, em bases Git
identicas, com tres configuracoes: provedor fixo, politica heuristica e futura
politica aprendida. Meça conclusao validada, custo conhecido por tarefa
resolvida, cobertura da medicao de custo, tokens, p95 de latencia, tentativas e
intervencoes. Dados desconhecidos nao entram como zero. Nao foi executado
benchmark com modelos reais nesta mudanca.

Ficam para evolucao experimental: roteador aprendido por resultados historicos,
intervencao ativa/replacement, geracao automatica de testes adversariais,
reutilizacao entre planos diferentes e migracao de versao MCP. A primeira
versao usa politicas explicitas e preserva os mecanismos existentes de prova.

## Radar tecnico semanal

O [guia do radar](radar-tecnico.md) vincula a pesquisa semanal ao estado do
repositorio, aos PRs e aos criterios de experimentacao do motor.

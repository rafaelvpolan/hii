# Avaliacao de evidencias por execucao

A extensao avaliacao v1 e anunciada em /v1/capacidades. GET
/v1/tarefas/{id}/avaliacao faz leitura autenticada e respeita o mesmo escopo
de projeto das demais rotas de tarefa. O cliente HII expoe avaliacao(id).

A resposta usa a revisao fixada no card, nao a ultima proposta editavel.
Confronta hash, sessao, conjunto de criterios obrigatorios, comandos e resultados.
Relatorio vazio, duplicado, incompleto ou inconsistente nao aprova criterios.

Para conferir atualidade, o motor calcula o fingerprint Git duas vezes e verifica
se card e relatorio permaneceram iguais durante a consulta. Arquivos novos fazem
parte do fingerprint. Diff externo, textconv e fsmonitor ficam desabilitados;
consultar nao roda os comandos de validacao, nao regrava evidencias e nao despacha IA.

## Estados e alcance da prova

- ausente: nao existe plano fixado ou evidencia dessa revisao.
- atual: relatorio corresponde ao trabalho no instante da consulta.
- desatualizada: Git, card ou relatorio mudou.
- indisponivel: worktree removido/inacessivel ou Git nao pode ser conferido.
- inconsistente: estrutura ou vinculo de plano/relatorio invalido.

Cada criterio tem estado efetivo e resultadoRegistrado. Quando nao ha prova atual,
o estado efetivo permanece inconclusivo, mesmo que o historico diga aprovado.
A API inclui comando, exit code, timeout, duracao, saida redigida, tentativa,
instante e identidade de planejamento/produto/revisao.

criteriosAprovados exige modo passivo, pelo menos um criterio obrigatorio e todos
eles aprovados com evidencia atual. Nao e autorizacao de merge nem prova de
resultado de produto. COMPLETED do gateway nao ganha garantias do pipeline.

O GET legado /plano continua igual, com atualidadeVerificada=false. Nenhuma
migracao e necessaria; desativar a extensao preserva o historico existente.

## Limites operacionais

Esta consulta e uma observacao datada, nao reserva o worktree contra mudancas
futuras. Execucoes sem certificado e sem worktree permanecem inconclusivas. O fecho
passivo pode preservar [evidencia de entrega](evidencia-de-entrega.md), conferida
contra o commit do PR e a arvore integrada em cada consulta. A leitura nao libera dependencias de produto para despacho.

Validacao usa Git e comando de teste reais em diretorios temporarios, transporte
HTTP e consumidor Hicode. Nao utiliza inferencia paga, daemon ou fila do operador.

## Diagnostico de temporizacao

A validacao reproduziu salto de relogio civil antecipando SIGKILL e declarando
sobrevivencia antes de esperar a morte do processo. A escalada agora usa tempo
monotonico, sem aumentar os limites. A duracao das evidencias tambem usa esse
relogio para nao ficar negativa quando a hora civil recua. Esperas das fixtures
afetadas usam o mesmo criterio; a fixture de daemon encerra seu processo mesmo
se uma assertiva falhar. Os testes incluem salto controlado de relogio.

O cache temporal da TUI tambem usa tempo monotonico: recuar o relogio civil nao prolonga a exibicao de um card ja encerrado. A regressao reproduz o recuo sem ampliar o TTL.

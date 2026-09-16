# Hardening de persistencia e revisao — 16/09/2026

Diagnostico e revisao sobre a main 18116e8, com as skills hii-desenvolver,
hii-diagnosticar e hii-revisar. Esta fatia contribui para #47, #49, #50 e #51;
nao conclui o epico #46 nem a execucao agentiva local #59.

## Causas reproduzidas e correcoes

- Lock antigo ou com espera expirada era apagado sem conferir o dono.
  Agora PID, host e token identificam a posse. Somente ESRCH no mesmo host
  permite recuperacao, serializada entre recuperadores. EPERM, host diferente,
  arquivo legado vazio ou metadados ilegíveis preservam o lock e geram diagnostico.
  Liberacao confere token e nao apaga uma posse substituida.
- Temporarios da escrita atomica usam identificador unico e sao limpos em falha.
- Resultado e lista de microtarefas concluidas sao gravados no mesmo checkpoint.
  Excecao ou processo encerrado sem confirmacao bloqueia repeticao automatica:
  reconciliar o efeito e publicar revisao explicita antes de retomar.
- Tentativas de evidencia sao imutaveis; o arquivo tradicional permanece
  como ponteiro para a ultima verificacao, preservando leitores existentes.
- Diff/lista de arquivos truncados bloqueiam review antes da inferencia.
  Falha do harness com texto APPROVED nao aprova. Alteracao de codigo ou base
  durante a chamada invalida o parecer, conservando o custo observado.
- Falha no registro de confianca de custo e diagnosticada sem descartar
  a resposta ja obtida da IA.

## Operacao e compatibilidade

A idade do lock nao comprova abandono. O timeout apenas limita a espera.
Locks antigos sem identificacao exigem verificacao operacional do dono;
a migracao nao os apaga automaticamente. O lock auxiliar de recuperacao
tambem falha de forma conservadora se ficar orfao.

A atualizacao deve ocorrer quando os processos escritores antigos tiverem
encerrado. Nao misture versoes antiga e nova escrevendo o mesmo estado: a
versao antiga continua capaz de remover locks por tempo. Nenhum processo
ou lock da instalacao ativa foi alterado por esta entrega.

Historico de evidencias fica em cards/evidencias/ID-REVISAO-TENTATIVA.json.
Nao apagar tentativas para esconder resultado inconclusivo. Reverter o codigo
nao requer apagar sessoes, checkpoints ou provas; a versao antiga nao conhece
as novas garantias.

## Verificacao

Fixtures cobrem dono vivo com lock antigo, dono morto, token substituido,
duas instancias disputando a mesma escrita (Hicode), efeito anterior a excecao,
retomada recusada, evidencia falha seguida de sucesso e harness falso que
retorna APPROVED em falha ou altera o trabalho durante a revisao.
Todos os repositorios e processos de teste sao temporarios.

O primeiro teste integral encontrou o apendice de variaveis desatualizado
e uma falha temporal de encerramento de harness. O apendice foi regenerado
pelo script oficial. As suites finais sao executadas em sequencia para evitar
disputa entre os testes de subprocessos. Os resultados finais ficam no PR.

Nao foram executadas inferencias pagas, piloto Ollama, alteracao do daemon,
merge ou deploy. A aprovacao tecnica nao equivale a aprovacao formal do GitHub.

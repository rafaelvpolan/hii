---
name: hii-diagnosticar
description: Diagnosticar cards parados, falhas de harness, cota, retomada e falta de progresso no motor HII. Use para investigação do HII; não para executar automaticamente a correção ou retomar a fila.
---

# Diagnosticar o HII

Leia `AGENTS.md` e comece por evidências de leitura. Identifique qual instalação,
estado e repositório pertencem ao incidente; não confunda o clone ativo com um
worktree de desenvolvimento. Nunca exponha conteúdo integral de credenciais ou
logs com segredos.

- Localize o card e seu `motor_modo`, status, `status_since`, `halt_class`,
  `halt_reason`, espera e histórico. Verifique se aguarda humano, provedor ou fila.
- Trace `fila.ts` para `gateway.ts`, `executar.ts` ou fecho. `doctor` saudável não
  prova progresso do card; compare transições e eventos ao longo do tempo.
- Em cota/transiente, confira rota, tentativas e próxima espera. Em falha de
  harness, confira saída e capacidades do adaptador. Em reinício, confira processo
  ainda vivo antes de concluir que o lock ou registro é órfão.
- No pipeline passivo, compare revisão/hash do plano, microtarefa e evidência com
  o estado do Git. Não trate evidência antiga como aprovação do diff atual.
- Separe observação, hipótese e reprodução. Proponha um teste isolado para a causa
  provável e indique os arquivos relevantes, sem reiniciar ou reenfileirar por conta própria.

Se o pedido também autorizar corrigir, prossiga com uma mudança delimitada em
branch de trabalho. Retomar cards, trocar provedor, apagar estado e reiniciar são
ações operacionais distintas: só execute as que estiverem no escopo solicitado.

Relate: sintoma, causa comprovada ou hipótese, evidência redigida, próximo passo e
limites da conclusão. Métricas históricas em `PENDENCIAS.md` podem estar vencidas;
não as apresente como custo atual sem nova medição.

## Incidentes entre painel e motor

Registre uma linha do tempo curta: acao solicitada, revisao enviada, resposta
recebida (ou timeout), efeito persistido, estado consultado e evento observado.
Consulte o estado autoritativo mesmo quando SSE falhar. API acessivel, daemon vivo,
tarefa admitida e harness em execucao sao fatos distintos.

Identifique a tarefa por instalacao/projeto/arquivo ou vinculo persistente, nunca
apenas pelo numero do card. Detecte duplicidade e compare filas antes de sugerir
retomada. Nao troque a fila inteira para resolver um unico card.

Para recuperacao, diferencie original, tentativa falha e configuracao comprovada.
Worktree ausente, snapshot adulterado, efeito externo incerto ou checkpoint
incompativel sao pendencias explicitas; reiniciar o servico nao as resolve.
Reproduza a fronteira que falhou em fixtures separadas antes de atribuir a causa
ao modelo ou afirmar que a correcao esta completa.

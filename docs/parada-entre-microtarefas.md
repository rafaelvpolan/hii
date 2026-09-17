# Parada durante implementacao

Quando o operador interrompe ou pausa o card enquanto a implementacao esta em
voo, a resposta tardia nao autoriza commit, URL, verificacao ou troca de IA.
O executor registra o resultado recebido e o custo/tokens reportados, conservando
o status e os campos da parada. O worktree permanece para inspecao.

O plano verifica o estado antes de cada microtarefa, inclusive ao reaproveitar
checkpoint, e depois de receber o resultado, inclusive na ultima microtarefa.
Uma etapa que terminou com sucesso conserva seu checkpoint e fingerprint;
parada humana nao significa que seu efeito deva ser repetido. A retomada exige
acao humana e usa as regras existentes de atualidade do checkpoint. Resultado
incerto continua exigindo reconciliacao.

## Evidencias

Fixtures com Git real e implementador falso reproduzem parada HALTED/PAUSED
durante a chamada, seguida de sucesso ou cota. Verificam HEAD e indice inalterados,
arquivo preservado, custo/tokens registrados, motivo humano conservado e nenhuma
consulta ao fallback. O caso de ultima etapa prova que a retomada humana nao
repete o efeito confirmado. Os testes nao fazem chamadas pagas.

## Limites e reversao

A guarda trata a resposta recebida quando o card esta parado. Nao e uma nova
implementacao de encerramento de subprocessos ou de cancelamento remoto. Efeitos
ja feitos pela IA continuam sujeitos a inspecao. Cancelamento e retomada imediata
antes do retorno da chamada precisam respeitar os locks e a reconciliacao do
worker existente; esta mudanca nao cria identificador de cancelamento por tentativa.

O incremento nao habilita paralelismo nem muda formato de checkpoint. Reverter
o commit nao exige migracao, mas reintroduz os efeitos tardios aqui descritos.

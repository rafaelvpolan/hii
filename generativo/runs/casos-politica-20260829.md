**PASSO 1: Identificação das Funções Exportadas e Ramos de Cada uma**

As funções exportadas do código são `backoffMsFor`, `haltFields`, `recordFailure`, e `applyFailurePolicy`. Vamos analisar os ramos de cada função:

1. **Function `backoffMsFor(attempt: number): number`**
   - **Ramo 1**: `attempt < 1`
     - Comportamento Esperado: Devolve `BACKOFF_STEPS_MS[0]`, que é `30_000`.
   - **Ramo 2**: `attempt > BACKOFF_STEPS_MS.length`
     - Comportamento Esperado: Devolve o último elemento de `BACKOFF_STEPS_MS`, que é `600_000`.
   - **Ramo 3**: `1 <= attempt <= BACKOFF_STEPS_MS.length`
     - Comportamento Esperado: Devolve `BACKOFF_STEPS_MS[idx]`, onde `idx` é o valor de `attempt` subtraído por `1`.

2. **Function `haltFields(input: FailurePolicyInput): Fields`**
   - **Ramo 1**: Sem ramificação específica, sempre devolve um objeto com campos preenchidos.

3. **Function `recordFailure(input: FailurePolicyInput, attempt: number, outcome: PolicyOutcome): void`**
   - **Ramo 1**: Sem ramificação específica, sempre executa as funções `stampRunFailure` e `appendFailureAttempt`.

4. **Function `applyFailurePolicy(input: FailurePolicyInput): PolicyOutcome`**
   - **Ramo 1**: `input.failureClass === 'quota'`
     - Comportamento Esperado: Chama `patchCard` com campos de status HALTED e retorna `'halt'`.
   - **Ramo 2**: `input.failureClass === 'terminal'`
     - Comportamento Esperado: Chama `patchCard` com campos de status HALTED e retorna `'halt'`.
   - **Ramo 3**: `attempts > maxWaitingAttempts()`
     - Comportamento Esperado: Chama `patchCard` com campos de status HALTED e retorna `'halt'`.
   - **Ramo 4**: Caso contrário
     - Comportamento Esperado: Chama `patchCard` com campos de status WAITING e retorna `'waiting'`.

**PASSO 2: Cenários de Borda Cobrindo os Ramos Reais**

Aqui estão 12 cenários de borda que cobrem os ramos reais:

1. **Cenario:** quota_halt
   - **Entrada/Condicao:** `input.failureClass = 'quota'`, `attempt = 1`
   - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.

2. **Cenario:** terminal_halt
   - **Entrada/Condicao:** `input.failureClass = 'terminal'`, `attempt = 1`
   - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.

3. **Cenario:** max_attempts_reached
   - **Entrada/Condicao:** `attempts = maxWaitingAttempts() + 1`
   - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.

4. **Cenario:** attempt_less_than_one
   - **Entrada/Condicao:** `attempt = 0`
   - **Comportamento Esperado:** Devolve `30_000` (primeiro valor de `BACKOFF_STEPS_MS`).

5. **Cenario:** attempt_greater_than_max_steps
   - **Entrada/Condicao:** `attempt = BACKOFF_STEPS_MS.length + 1`
   - **Comportamento Esperado:** Devolve `600_000` (último valor de `BACKOFF_STEPS_MS`).

6. **Cenario:** attempt_between_steps
   - **Entrada/Condicao:** `attempt = 3`
   - **Comportamento Esperado:** Devolve `120_000` (valor do terceiro elemento de `BACKOFF_STEPS_MS`).

7. **Cenario:** halt_fields_all_fields
   - **Entrada/Condicao:** Qualquer `FailurePolicyInput` válido
   - **Comportamento Esperado:** Retorna um objeto com todos os campos preenchidos corretamente.

8. **Cenario:** record_failure_halt
   - **Entrada/Condicao:** Qualquer `FailurePolicyInput`, `attempt = 1`, `outcome = 'halt'`
   - **Comportamento Esperado:** Executa `stampRunFailure` e `appendFailureAttempt`.

9. **Cenario:** record_failure_waiting
   - **Entrada/Condicao:** Qualquer `FailurePolicyInput`, `attempt = 2`, `outcome = 'waiting'`
   - **Comportamento Esperado:** Executa `stampRunFailure` e `appendFailureAttempt`.

10. **Cenario:** apply_policy_quota_halt
    - **Entrada/Condicao:** `input.failureClass = 'quota'`, `attempt = 1`
    - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.

11. **Cenario:** apply_policy_terminal_halt
    - **Entrada/Condicao:** `input.failureClass = 'terminal'`, `attempt = 1`
    - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.

12. **Cenario:** apply_policy_max_attempts_reached_halt
    - **Entrada/Condicao:** `attempts = maxWaitingAttempts() + 1`
    - **Comportamento Esperado:** Chama `patchCard` com status HALTED e retorna `'halt'`.
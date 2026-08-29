1. **Cenario:** Inicialização do diretório de execuções com sucesso
   - **Entrada/Condicao:** `cardsDir()` retorna um caminho válido e existe.
   - **Comportamento Esperado:** O diretório 'runs' é criado dentro de 'cardsDir'.

2. **Cenario:** Arquivo attempts.json não existente
   - **Entrada/Condicao:** `attemptsFile(id)` retorna um caminho para um arquivo que não existe.
   - **Comportamento Esperado:** Função retorna um array vazio.

3. **Cenario:** Conteúdo inválido em attempts.json
   - **Entrada/Condicao:** Arquivo attempts.json contém conteúdo inválido.
   - **Comportamento Esperado:** Função retorna um array vazio.

4. **Cenario:** Tentativa de gravar um objeto Attempt no arquivo attempts.json com sucesso
   - **Entrada/Condicao:** Chamar `appendAttempt(id, 'reprovacao', 'Motivo', 'Resposta')`.
   - **Comportamento Esperado:** O objeto é adicionado ao array em attempts.json.

5. **Cenario:** Arquivo failures.json não existente
   - **Entrada/Condicao:** `failuresFile(id)` retorna um caminho para um arquivo que não existe.
   - **Comportamento Esperado:** Função retorna um array vazio.

6. **Cenario:** Conteúdo inválido em failures.json
   - **Entrada/Condicao:** Arquivo failures.json contém conteúdo inválido.
   - **Comportamento Esperado:** Função retorna um array vazio.

7. **Cenario:** Tentativa de gravar um objeto FailureAttempt no arquivo failures.json com sucesso
   - **Entrada/Condicao:** Chamar `appendFailureAttempt(id, { attempt: 1, fromStatus: 'inicial', provider: 'provedor', failureClass: 'class', failureReason: 'Motivo' })`.
   - **Comportamento Esperado:** O objeto é adicionado ao arquivo failures.json.

8. **Cenario:** Limite de caracteres para campo reason em Attempt
   - **Entrada/Condicao:** Chamar `appendAttempt(id, 'reprovacao', ''.padStart(2001), 'Resposta')`.
   - **Comportamento Esperado:** O campo reason é cortado a 2000 caracteres.

9. **Cenario:** Limite de caracteres para campo response em Attempt
   - **Entrada/Condicao:** Chamar `appendAttempt(id, 'reprovacao', 'Motivo', ''.padStart(8001))`.
   - **Comportamento Esperado:** O campo response é cortado a 8000 caracteres.

10. **Cenario:** Limite de caracteres para campo failureReason em FailureAttempt
    - **Entrada/Condicao:** Chamar `appendFailureAttempt(id, { attempt: 1, fromStatus: 'inicial', provider: 'provedor', failureClass: 'class', failureReason: ''.padStart(501) })`.
    - **Comportamento Esperado:** O campo failureReason é cortado a 500 caracteres.

11. **Cenario:** Tentativa de ler arquivos attempts.json e failures.json sem garantia de existência
    - **Entrada/Condicao:** `readAttempts(id)` ou `readFailureAttempts(id)` com arquivo inexistente.
    - **Comportamento Esperado:** Função retorna um array vazio.

12. **Cenario:** Leitura de conteúdo corrompido no arquivo attempts.json
    - **Entrada/Condicao:** Arquivo attempts.json contém conteúdo parcialmente corrompido.
    - **Comportamento Esperado:** A função lê apenas os objetos válidos e retorna um array.

13. **Cenario:** Leitura de conteúdo corrompido no arquivo failures.json
    - **Entrada/Condicao:** Arquivo failures.json contém linhas parcialmente corrompidas.
    - **Comportamento Esperado:** A função lê apenas os objetos válidos e retorna um array.

14. **Cenario:** Tentativa de ler arquivos attempts.json e failures.json com diretório inexistente
    - **Entrada/Condicao:** `cardsDir()` retorna um caminho que não existe.
    - **Comportamento Esperado:** Funções retornam arrays vazios.

15. **Cenario:** [VERIFICAR] Tratamento de falhas ao ler ou escrever arquivos
    - **Entrada/Condicao:** Simular erros na leitura ou escrita do sistema de arquivos.
    - **Comportamento Esperado:** Funções lidam adequadamente com erros e retornam arrays vazios.
1. **Cenario de borda: Erro de quota**
   - **Entrada/Condicao:** failureClass = 'quota', failureReason = "Quota excedida"
   - **Comportamento Esperado:** Motor deve parar e configurar HICODE_QUOTA_FALLBACK para permitir troca explicita.

2. **Cenario de borda: Erro terminal**
   - **Entrada/Condicao:** failureClass = 'terminal', failureReason = "Erro irreparável"
   - **Comportamento Esperado:** Motor deve parar e registrar o erro terminal.

3. **Cenario de borda: Número de tentativas esgotadas**
   - **Entrada/Condicao:** attempt > maxWaitingAttempts()
   - **Comportamento Esperado:** Motor deve parar após exceder o número máximo de tentativas.

4. **Cenario de borda: Primeira tentativa**
   - **Entrada/Condicao:** attempt = 1
   - **Comportamento Esperado:** Motor deve aguardar por 30 segundos antes da próxima tentativa.

5. **Cenario de borda: Segunda tentativa**
   - **Entrada/Condicao:** attempt = 2
   - **Comportamento Esperado:** Motor deve aguardar por 1 minuto antes da próxima tentativa.

6. **Cenario de borda: Tercera tentativa**
   - **Entrada/Condicao:** attempt = 3
   - **Comportamento Esperado:** Motor deve aguardar por 2 minutos antes da próxima tentativa.

7. **Cenario de borda: Quarta tentativa**
   - **Entrada/Condicao:** attempt = 4
   - **Comportamento Esperado:** Motor deve aguardar por 5 minutos antes da próxima tentativa.

8. **Cenario de borda: Quinta tentativa**
   - **Entrada/Condicao:** attempt = 5
   - **Comportamento Esperado:** Motor deve aguardar por 10 minutos antes da próxima tentativa.

9. **Cenario de borda: Sexta tentativa**
   - **Entrada/Condicao:** attempt = 6
   - **Comportamento Esperado:** Motor deve parar após exceder o número máximo de tentativas.

10. **Cenario de borda: Tentativa zero (inconsistência)**
    - **Entrada/Condicao:** attemptNumber(id) retorna 0
    - **Comportamento Esperado:** Motor deve aguardar por 60 minutos antes da próxima tentativa.

11. **Cenario de borda: Tentativa máxima (maxWaitingAttempts())**
    - **Entrada/Condicao:** attemptNumber(id) retorna maxWaitingAttempts()
    - **Comportamento Esperado:** Motor deve parar após exceder o número máximo de tentativas.

12. **Cenario de borda: ExtraFields não informados**
    - **Entrada/Condicao:** input.extraFields = undefined
    - **Comportamento Esperado:** Campos extra devem ser ignorados, apenas os padrões serão usados.

13. **Cenario de borda: Tentativa final com sucesso**
    - **Entrada/Condicao:** attemptNumber(id) retorna maxWaitingAttempts() - 1 e outcome = 'success'
    - **Comportamento Esperado:** Motor deve continuar a operação sem parar.

14. **Cenario de borda: Erro técnico inesperado**
    - **Entrada/Condicao:** failureClass = undefined, technicalDetail = "Erro desconhecido"
    - **Comportamento Esperado:** Motor deve parar e registrar o erro técnico.

15. **Cenario de borda: Erro de conexão (URL_OK)**
    - **Entrada/Condicao:** resumeStatus = 'URL_OK', failureReason = "Conexão falhou"
    - **Comportamento Esperado:** Motor deve parar e registrar o erro de conexão, mas não deve tentar novamente.
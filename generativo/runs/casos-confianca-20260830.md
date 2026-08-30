1. **Cenario:** `markRefsRefused` com ID vazio e array de resultados sem recusa
   - **Entrada/Condicao:** id = "", outcomes = []
   - **Comportamento Esperado:** Nenhuma ação

2. **Cenario:** `markRefsRefused` com ID válido e array de resultados vazios
   - **Entrada/Condicao:** id = "card123", outcomes = []
   - **Comportamento Esperado:** Nenhuma ação

3. **Cenario:** `markRefsRefused` com ID válido e array de resultados sem recusa
   - **Entrada/Condicao:** id = "card123", outcomes = [{ source: "url", outcome: "success" }]
   - **Comportamento Esperado:** Nenhuma ação

4. **Cenario:** `markRefsRefused` com ID válido e array de resultados com uma recusa
   - **Entrada/Condicao:** id = "card123", outcomes = [{ source: "url", refusal: { reason: "reason1", detail: "detail1" } }]
   - **Comportamento Esperado:** Chama `patchCard("card123", {}, refRefusalLine(...))`

5. **Cenario:** `markRefsRefused` com ID válido e array de resultados com múltiplas recusas
   - **Entrada/Condicao:** id = "card123", outcomes = [
     { source: "url1", refusal: { reason: "reason1", detail: "detail1" } },
     { source: "url2", refusal: { reason: "reason2", detail: "detail2" } }
   ]
   - **Comportamento Esperado:** Chama `patchCard("card123", {}, refRefusalLine(...))` duas vezes

6. **Cenario:** `refRefusalLine` com source longo e detalhes longos
   - **Entrada/Condicao:** source = "http://longurl.com/path/to/resource?query=parameters&more=params", refusal = { reason: "reason with a very long text that should be clipped", detail: "detail with a very long text that should also be clipped" }
   - **Comportamento Esperado:** Retorna string com source e detalhes clippados

7. **Cenario:** `refRefusalLine` com motivo de recusa vazio
   - **Entrada/Condicao:** source = "url", refusal = { reason: "", detail: "detail" }
   - **Comportamento Esperado:** Retorna string sem o motivo de recusa

8. **Cenario:** `markRefsRefused` com ID válido e array de resultados com uma recusa nula
   - **Entrada/Condicao:** id = "card123", outcomes = [{ source: "url", refusal: null }]
   - **Comportamento Esperado:** Nenhuma ação
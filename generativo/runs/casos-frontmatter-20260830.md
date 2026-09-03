1. **Cenario:** parseFrontMatterVazio
   - **Entrada/Condicao:** `text = ""`
   - **Comportamento Esperado:** `{ fm: {}, order: [], body: "" }`

2. **Cenario:** parseFrontMatterSemFM
   - **Entrada/Condicao:** `text = "Conteúdo do card"`
   - **Comportamento Esperado:** `{ fm: {}, order: [], body: "Conteúdo do card" }`

3. **Cenario:** parseFrontMatterComFMVazio
   - **Entrada/Condicao:** `text = "---\n---\nConteúdo do card"`
   - **Comportamento Esperado:** `{ fm: {}, order: [], body: "Conteúdo do card" }`

4. **Cenario:** parseFrontMatterComFMIncompleto
   - **Entrada/Condicao:** `text = "---\nkey:value\n---\nConteúdo do card"`
   - **Comportamento Esperado:** `{ fm: { key: "value" }, order: [ "key" ], body: "Conteúdo do card" }`

5. **Cenario:** parseFrontMatterComFMCompleto
   - **Entrada/Condicao:** `text = "---\nkey1:value1\nkey2:value2\n---\nConteúdo do card"`
   - **Comportamento Esperado:** `{ fm: { key1: "value1", key2: "value2" }, order: [ "key1", "key2" ], body: "Conteúdo do card" }`

6. **Cenario:** parseFrontMatterComFMOrdenado
   - **Entrada/Condicao:** `text = "---\nkey3:value3\nkey1:value1\nkey2:value2\n---\nConteúdo do card"`
   - **Comportamento Esperado:** `{ fm: { key3: "value3", key1: "value1", key2: "value2" }, order: [ "key1", "key2", "key3" ], body: "Conteúdo do card" }`

7. **Cenario:** serializeCardComFMVazio
   - **Entrada/Condicao:** `fm = {}, order = [], body = "Conteúdo do card"`
   - **Comportamento Esperado:** "---\n---\n\nConteúdo do card"

8. **Cenario:** serializeCardComFMCompleto
   - **Entrada/Condicao:** `fm = { key1: "value1", key2: "value2" }, order = [ "key1", "key2" ], body = "Conteúdo do card"`
   - **Comportamento Esperado:** "---\nkey1: value1\nkey2: value2\n---\n\nConteúdo do card"

9. **Cenario:** serializeCardComFMOrdenado
   - **Entrada/Condicao:** `fm = { key3: "value3", key1: "value1", key2: "value2" }, order = [ "key1", "key2", "key3" ], body = "Conteúdo do card"`
   - **Comportamento Esperado:** "---\nkey1: value1\nkey2: value2\nkey3: value3\n---\n\nConteúdo do card"

10. **Cenario:** serializeCardComFMVaziaEmOrdem
    - **Entrada/Condicao:** `fm = {}, order = [ "key" ], body = "Conteúdo do card"`
    - **Comportamento Esperado:** "---\n---\n\nConteúdo do card"
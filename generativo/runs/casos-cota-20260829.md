**Cenario:** JANELA_COTA_MS = 0  
- **Entrada/Condicao:** Agora é exatamente o início da janela cota.  
- **Comportamento Esperado:** A janela de provedores não deve estar vencendo, todos os valores devem ser zero ou iniciais.

**Cenario:** JANELA_COTA_MS = 1000  
- **Entrada/Condicao:** Agora é apenas um segundo após o início da janela cota.  
- **Comportamento Esperado:** A janela de provedores deve estar vencendo em menos de um segundo.

**Cenario:** JANELA_COTA_MS = Number.MAX_SAFE_INTEGER  
- **Entrada/Condicao:** Agora é o maior número seguro em JavaScript.  
- **Comportamento Esperado:** A janela de provedores não deve existir, devem haver erros ou valores inválidos.

**Cenario:** JANELA_COTA_MS = Number.MIN_SAFE_INTEGER  
- **Entrada/Condicao:** Agora é o menor número seguro em JavaScript.  
- **Comportamento Esperado:** A janela de provedores não deve existir, devem haver erros ou valores inválidos.

**Cenario:** agoraMs = JANELA_COTA_MS / 2  
- **Entrada/Condicao:** Agora é meio da janela cota.  
- **Comportamento Esperado:** A janela de provedores deve estar vencendo em menos que a metade do tempo restante.

**Cenario:** agoraMs = JANELA_COTA_MS * 3  
- **Entrada/Condicao:** Agora é três vezes a duração da janela cota.  
- **Comportamento Esperado:** A janela de provedores não deve existir, devem haver erros ou valores inválidos.

**Cenario:** agoraMs = 0  
- **Entrada/Condicao:** Agora é zero (tempo inicial).  
- **Comportamento Esperado:** Deve ocorrer um erro porque a janela cota não pode ser calculada com tempo negativo.

**Cenario:** agoraMs = Number.POSITIVE_INFINITY  
- **Entrada/Condicao:** Agora é infinitamente longe.  
- **Comportamento Esperado:** A janela de provedores não deve existir, devem haver erros ou valores inválidos.

**Cenario:** agoraMs = Number.NEGATIVE_INFINITY  
- **Entrada/Condicao:** Agora é infinitamente atrás.  
- **Comportamento Esperado:** Deve ocorrer um erro porque a janela cota não pode ser calculada com tempo negativo.

**Cenario:** JANELA_COTA_MS = NaN  
- **Entrada/Condicao:** JANELA_COTA_MS é not-a-number.  
- **Comportamento Esperado:** A função deve retornar erros ou valores inválidos.

**Cenario:** agoraMs = NaN  
- **Entrada/Condicao:** Agora é not-a-number.  
- **Comportamento Esperado:** Deve ocorrer um erro porque a janela cota não pode ser calculada com tempo inválido.
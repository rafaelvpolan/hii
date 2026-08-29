**Cenario:** Cota vazia  
  - **Entrada/Condicao:** "registro com ias=[]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota vazia com janelaViraDaquiMs = 0.

**Cenario:** Primeiro registro, sem falhas  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com o primeiro registro na lista de provedores.

**Cenario:** Provedor desconhecido  
  - **Entrada/Condicao:** "registro com ias=[{provedor:PROVEDOR_DESCONHECIDO, classeDeFalha:'quota'}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com o provedor desconhecido listado.

**Cenario:** Registro com falha de quota  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:'quota'}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna ['claude'], oLimiteEDesteProvedor retorna true para 'claude', e a função lerCota deve retornar uma LeituraDeCota com o registro marcado como estourando cota.

**Cenario:** Registro com múltiplos provedores  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined}, {provedor:' Anthropic', classeDeFalha:'quota'}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna ['Anthropic'], oLimiteEDesteProvedor retorna true para 'Anthropic', e a função lerCota deve retornar uma LeituraDeCota com ambos os provedores na lista, com 'Anthropic' marcado como estourando cota.

**Cenario:** Registro com múltiplas falhas de quota  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:'quota'}, {provedor:'Anthropic', classeDeFalha:'quota'}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna ['claude', 'Anthropic'], oLimiteEDesteProvedor sempre retorna true para ambos, e a função lerCota deve retornar uma LeituraDeCota com ambos os provedores na lista, marcados como estourando cota.

**Cenario:** Registro sem provedores identificados  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined}, {provedor:undefined, classeDeFalha:'quota'}]"  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com o registro marcado como não identificado.

**Cenario:** Registro com provedores em diferentes fases  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined}, {provedor:'Anthropic', classeDeFalha:'quota'}]" e agoraMs no passado  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna ['Anthropic'], oLimiteEDesteProvedor sempre retorna true para 'Anthropic', e a função lerCota deve retornar uma LeituraDeCota com ambos os provedores na lista, com 'Anthropic' marcado como estourando cota.

**Cenario:** Registro com provedor com modelos repetidos  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined, modelos:['gpt-3']}]" e agoraMs no passado  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com os modelos listados apenas uma vez.

**Cenario:** Registro com provedor sem modelos  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined, modelos:[]}]" e agoraMs no passado  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com os modelos vazios.

**Cenario:** Registro com provedor sem cards  
  - **Entrada/Condicao:** "registro com ias=[{provedor:'claude', classeDeFalha:undefined}]" e agoraMs no passado  
  - **Comportamento Esperado:** provedoresQueEstouraramCota retorna [], oLimiteEDesteProvedor sempre retorna false, e a função lerCota deve retornar uma LeituraDeCota com os cards vazios.
---
id: deploy-strategies
papeis: [empacotador, planejador, avaliador]
arquivos: ["**/k8s/**", "**/kubernetes/**", "**/helm/**", "**/*.tf", "**/docker-stack.yml", "**/.github/workflows/**", "**/deploy/**"]
---
**Deploy é o momento em que duas versões do código convivem.** Quase todo
defeito de deploy nasce de esquecer isso e tratar a troca como instantânea.

## Compatibilidade nos dois sentidos

Durante o deploy, a versão nova fala com dados escritos pela antiga, e a antiga
com dados escritos pela nova. Consequências práticas:

- **Migração de banco vai antes, e é compatível com a versão anterior.**
  Migração que renomeia ou remove coluna derruba as réplicas antigas que ainda
  estão servindo. A sequência segura é expandir, migrar, contrair — em deploys
  separados.
- Formato de mensagem em fila e de item em cache também tem duas versões em voo.

## Escolher a estratégia pelo que se quer poder desfazer

- **Rolling**: substitui aos poucos. Barato, e é o padrão razoável. Volta é
  outro rolling, então o tempo de reversão é o tempo de um deploy.
- **Blue-green**: duas pilhas completas, troca de tráfego atômica. Reversão é
  imediata; o custo é manter duas pilhas e resolver o estado compartilhado.
- **Canário**: fração do tráfego na versão nova, com critério **numérico** de
  promoção. Sem número definido antes, "parece bem" decide, e parece bem é o que
  se enxerga em 5 minutos de tráfego baixo.

## Reversão é ensaiada, não improvisada

O caminho de volta é conhecido e já foi executado alguma vez fora de incidente.
Reversão que nunca rodou é hipótese — e a hora de descobrir que ela não funciona
não é às 3 da manhã. Onde não há caminho de volta (migração destrutiva, mensagem
já consumida), isso é dito no plano, antes.

## Configuração e artefato

- O artefato promovido entre ambientes é **o mesmo**. Reconstruir por ambiente
  testa uma coisa e publica outra.
- Toda versão em produção é identificável: a imagem vem de registro, com tag
  imutável. Construir no host de produção é não saber o que está rodando.

## Sinal para parar

Defina antes do deploy quais números interrompem: taxa de erro, latência de
cauda, profundidade de fila. Interromper cedo custa um deploy; interromper tarde
custa o incidente.

---
name: hii-revisar
description: Revisar diffs e PRs do motor HII quanto a regressões de execução, persistência, orçamento e evidências. Use antes de integrar mudanças no próprio motor, com achados apoiados no código e nos testes.
---

# Revisar o HII

Leia `AGENTS.md`. Compare o diff com a base real do PR ou com a base indicada no
pedido; inspecione os chamadores dos trechos alterados, não só funções isoladas.

Concentre a revisão nas garantias afetadas:

- **Estado:** transição correta, parada humana preservada, escritas atômicas e
  exclusão por projeto/card mantidas; exceção não pode virar sucesso silencioso.
- **Retomada:** plano/revisão/fingerprint corretos e efeitos concluídos não
  repetidos; alteração externa deve invalidar evidência relevante.
- **Execução:** diretório certo, escopo, capacidade do harness e timeout; papel
  no prompt não prova delegação nem isolamento.
- **Custo/falha:** custo desconhecido, gasto acumulado, troca de provedor,
  classificação terminal/transiente/cota e condição de parada.
- **Entrega:** critério obrigatório inconclusivo bloqueia; gateway não herda as
  garantias do pipeline; PR permanece sujeito ao merge humano.
- **Instruções:** comandos existem, caminhos sobrevivem ao clone e exemplos não
  alteram a instalação ativa durante um teste.

Execute testes relevantes em fixtures quando necessário. Não inicie o daemon,
faça merge ou modifique o diff só por estar revisando. Se o pedido incluir consertar
achados, mantenha essas alterações identificáveis e valide o resultado.

Relate apenas achados acionáveis, com arquivo/linha, condição que dispara o
problema, impacto e correção sugerida. Separe limitações de cobertura de defeitos
confirmados; se não encontrar achados, diga isso e registre o que foi verificado.

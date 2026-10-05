# Prompt primeiro, troca de IA com confirmação, limite de custo e IA por tarefa

## Prompt primeiro

Nenhuma execução chama IA antes de o pedinte aprovar o pacote de execução.

1. Quando a fila pega uma tarefa em `EXECUTING`, `liberarPeloPacote` (motor/niemeyer/lucio/aprovacao-do-pacote.ts) monta o pacote sem chamar IA: prompt do implementador, IA e modelo por papel, agentes escolhidos, skills que disparam, gates do pipeline, portões de build e teste do contrato, limites de custo e aviso de cota.
2. O pacote é gravado em `cards/pacotes/<id>.md`, a tarefa vai para `CLARIFY` e a pergunta "Aprovar e executar?" aparece no mesmo canal da TUI e da API (`GET /v1/tarefas/{id}/perguntas`).
3. Respostas: `1` ou "Aprovar e executar" libera; `2` ou "Cancelar a tarefa" para como parada humana; texto livre vira instrução adicional e gera um pacote novo antes de qualquer IA.
4. A aprovação vale para o hash do pacote (objetivo, modo, agentes, skills, gates, portões). Trocar de IA não muda o hash e não pede nova aprovação; mudar o pedido pede.

`HII_PROMPT_PRIMEIRO=off` desliga. `GET /v1/tarefas/{id}/pacote` devolve o pacote para o painel.

## Troca de IA por cota com confirmação

`HII_QUOTA_FALLBACK` tem três modos: `perguntar` (padrão), `on` (troca automática, comportamento anterior) e `off` (para sem recomendar).

- Antes de a cota acabar: a cada chamada, se uma janela medida passa de `HII_COTA_AVISO_PCT` (padrão 80), o card recebe `cota_aviso` com a IA recomendada, uma vez por janela.
- Quando a cota acaba: o roteador escolhe o melhor candidato apto, a tarefa para em `HALTED` com `troca_recomendada` e a pergunta "Trocar para X e retomar?". Aceitar retoma no provedor recomendado com o contexto da troca; recusar mantém a tarefa parada.

## Limite de custo por execução

O teto é "US$ `orcamentoPorCard.tetoUsd` ou `orcamentoPorCard.tetoTokens` tokens, o que vier primeiro" (config/model-tier.json). O teto em tokens vale para provedores que não informam custo em dólar, cujo `cost_usd` fica zero. Sobreposição por `HII_CARD_BUDGET_USD` e `HII_CARD_BUDGET_TOKENS`. Execução, gateway e plano param em `HALTED` com `halt_class: orcamento` antes da chamada paga.

## IA por tarefa

`GET /v1/tarefas/{id}/ia` lista a IA de cada papel (implement, verify, gate, step); vazio é o padrão do motor. `POST /v1/tarefas/{id}/ia` com `{papel, provedor, modelo?}`, `If-Match` e `Idempotency-Key` define a IA do card, com as mesmas validações de capacidade de `/v1/configuracao`. `GET /v1/configuracao` mostra `execucao.trocaPorCota`, `execucao.promptPrimeiro` e `limites`.

A escolha humana também fica em `ia_escolhida_<papel>`. Parada por falha e fim da implementação limpam só a troca automática do roteador; a IA escolhida pelo humano volta ao `provider_override_<papel>`, então retomar a tarefa usa a mesma IA. Aceitar a troca por cota conta como escolha humana.

## Ollama agentivo

Erro de uso de ferramenta (argumento a mais, `old_text` ambíguo, validação que falhou) volta ao modelo como resposta da ferramenta, sem alterar nada, para ele corrigir a chamada. Erro de segurança (caminho fora do workspace, modo somente leitura) continua encerrando a execução. Em modo de edição, a resposta final só vale depois de pelo menos um `replace_text` aplicado. Sem isso o motor cobra o modelo uma vez e, se ele de novo só descrever a chamada em texto, a execução falha com "nenhuma edicao foi comprovada" em vez de concluir sem mudar nada.

## Pastas por IA no projeto-alvo

`hii init` cria `.hii/memory/` e `.hii/ia/<ia>/{agents,skills}` para claude e ollama. Papel em `.hii/ia/<ia>/agents/` vence o catálogo do motor quando aquela IA executa. `hii projetar <repo> claude` grava o bloco gerenciado do `CLAUDE.md` a partir de `.hii/rules.md` e copia papéis e skills para `.claude/agents` e `.claude/skills`, preservando arquivo humano diferente.

## Integração do Codex

O adaptador do Codex usa os mesmos pontos sem mudança no núcleo: `.hii/ia/codex/agents` já tem precedência pelo `provider.name`; a projeção nativa (AGENTS.md, `.agents/skills`, `.codex/`) entra como função irmã de `projetarParaClaude` em motor/cordel/alicerce/pastas-por-ia.ts e um ramo no comando `projetar`. Pacote, troca por cota, teto de tokens e IA por tarefa valem para qualquer harness.

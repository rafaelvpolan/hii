# Execucao local com prompt aprovado

O HII executa e oferece a TUI/API. O Hicode acompanha e envia decisoes humanas pela API. VPS fica fora deste piloto.

## Preparar o projeto-alvo

```bash
hii init /caminho/do/projeto
hii projetar /caminho/do/projeto claude
hii projetar /caminho/do/projeto codex
```

A fonte das regras e `.hii/rules.md`. A memoria duravel compartilhada fica em `.hii/memory/`; agentes e skills ficam em `.hii/ia/{claude,codex,ollama}/`. Skills do Codex sao projetadas em `.agents/skills/`; papeis do Codex sao instrucoes injetadas pelo motor, sem prometer subagentes nativos. Claude usa `CLAUDE.md`, `.claude/agents/` e `.claude/skills/`. A projecao preserva arquivos humanos divergentes e ignora links simbolicos na fonte.

## Claude e Codex usando Ollama

Instale os CLIs e inicie o servidor Ollama local. Escolha um modelo instalado com ferramentas e contexto suficiente. Nenhum comando abaixo faz download de modelo nem altera seu login global.

```bash
export HII_OLLAMA_URL=http://localhost:11434
export HII_CLAUDE_OLLAMA_MODEL=qwen3-coder:30b
export HII_CODEX_OLLAMA_MODEL=qwen3-coder:30b
export HII_PROMPT_PRIMEIRO=on
export HII_QUOTA_FALLBACK=perguntar
export HII_CARD_BUDGET_USD=5
export HII_CARD_BUDGET_TOKENS=200000
```

Na TUI, selecione `/ia claude-ollama` ou `/ia codex-ollama`. No Hicode, escolha o provedor na tarefa e aplique o modelo na implementacao. Os provedores `claude` e `codex` continuam usando seus servicos nativos. O transporte Ollama dos novos adaptadores aceita somente loopback neste piloto; isso nao certifica que um modelo com encaminhamento para nuvem executa localmente.

O Claude recebe o endpoint e um token local apenas no subprocesso. O Codex recebe `--oss --local-provider ollama`. Nenhum adaptador altera configuracoes ou credenciais globais dos CLIs; os CLIs podem manter seus proprios logs e caches.

## Aprovar e trocar

Antes da primeira execucao, a tarefa entra em CLARIFY com o prompt, as IAs por papel, agentes, skills, gates e limites. Na TUI leia o pacote com `/pacote <id>` e use o canal de respostas; no Hicode leia o pacote e clique em **Aprovar e executar**. Texto livre ajusta o pedido e gera outro pacote.

Mudancas em regras, prompt, IA/modelo ou contrato invalidam a identidade aprovada. Uma resposta a um pacote desatualizado gera o pacote novo e pede outra revisao. Tarefas antigas ja iniciadas mantem a compatibilidade de retomada.

O aviso antecipado de cota aparece a partir de 80% de uma janela confiavel (ajustavel em `HII_COTA_AVISO_PCT`). O aviso recomenda outra IA quando ha alternativa apta. A troca pode ser escolhida na TUI/painel; quando a cota acaba, o modo perguntar exige resposta humana antes da troca. Nunca interprete ausencia de medicao como cota livre.

O teto financeiro barra novas chamadas quando o gasto conhecido atinge o limite; Claude tambem recebe o saldo via `--max-budget-usd`. Uma chamada em voo pode consumir saldo antes do proximo checkpoint. Codex e alguns backends nao informam custo: o valor permanece desconhecido/piso, e o limite de tokens continua sendo aplicado. Estes tetos nao garantem faturamento maximo de provedores sem medicao.

Fontes oficiais: [Claude Code com Ollama](https://docs.ollama.com/integrations/claude-code), [Codex com Ollama](https://docs.ollama.com/integrations/codex).

## Capacidade de memoria no piloto

Antes de chamar os CLIs locais, o motor verifica o catalogo e o tamanho do modelo. O teto conservador padrao e 80% da RAM visivel ao processo. Um modelo maior e recusado antes do carregamento, com alternativas instaladas quando identificadas. O motor nao presume memoria de GPU: `HII_OLLAMA_MEMORY_BUDGET_MB` permite declarar um teto adequado ao hardware, incluindo GPU quando comprovado pelo operador. Esse teto compara o arquivo do modelo; contexto, cache e outras tarefas tambem precisam de folga.

Claude e Codex por Ollama compartilham os mesmos slots de inferencia do servidor, inclusive com o executor Ollama do motor. O padrao e uma chamada por servidor/modelo. Artefatos de execucao sem prompts nem credenciais ficam em `.hii/ia/<ia>/executions/<tarefa>.jsonl`; custo desconhecido permanece `null`.

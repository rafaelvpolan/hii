# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## PRECISO DE VOCÊ — histórico de prompt por sessão e comando `/end`

Você pediu, junto com a resposta do hook: *"manter o histórico de mensagem de
prompt em cada sessão quando iniciada, colocar também comando `/end` para
determinar final de sessão e limpar memória e usar uma nova (veja o melhor
método a se seguir com múltiplas IAs integradas)"*.

**Não implementei ainda porque três leituras diferentes dão trabalhos
diferentes**, e errar sai caro. O que já existe hoje:

| Peça | Onde | O que guarda |
|---|---|---|
| Ledger por sessão | `motor/euc/ias-da-sessao.ts` | chamada de IA: papel, provedor, custo, tokens — **não o texto do prompt** |
| Sessão da TUI | `motor/mir/sessao.ts:58` | já tem `/new-session` e `/historico` na lista de comandos |
| Id de sessão | `motor/euc/sessao.ts` | `sessaoAtual()`, `reiniciarSessao()` |
| Memória do projeto | `motor/csd/memoria.ts` | `.hii/memory/motor.md`, injetada no prompt do implementador |

**As três perguntas que mudam o que eu escrevo:**

1. **O histórico de prompt é para auditoria ou para contexto?** Se é para você
   ler depois ("o que foi pedido nesta sessão"), é só gravar o texto no ledger
   e mostrar no `/historico` — barato. Se é para **alimentar as chamadas
   seguintes**, colide de frente com o item 17 (prefixo estável): o prefixo
   precisa bater byte a byte entre chamadas para o cache do provedor valer, e
   histórico crescendo no meio dele mata o desconto e multiplica o token de
   entrada a cada turno.

2. **`/end` limpa qual memória?** A sessão da TUI (`newSession`), o ledger da
   sessão, ou a memória do projeto em `.hii/memory/motor.md`? A última é
   aprendizado acumulado entre cards — apagar ali é perda real, não limpeza.

3. **Com múltiplas IAs, o histórico é único ou por harness?** Único é mais
   simples de ler, mas cada provedor tem janela e formato próprios, e um
   histórico compartilhado que não cabe na janela do menor deles vira truncagem
   silenciosa — exatamente o tipo de degradação invisível que este motor evita
   em todo lugar.

**Minha recomendação, se você não quiser detalhar:** gravar o texto do prompt
no ledger da sessão (auditoria), expor no `/historico`, e fazer `/end` encerrar
a sessão da TUI e abrir uma nova **sem tocar** em `.hii/memory/`. É a leitura
mais barata, não briga com o item 17, e não apaga aprendizado. Diga se é isso.

---

## PRÓXIMA ONDA — três itens que você mandou verificar e resolver

**1. O laço de conflito de merge, fora do padrão de reparo.**
`motor/qlb/ctr/sync.ts:41-64` tem laço próprio com teto próprio
(`MAX_CONFLICT`), não usa `repararAteOTeto` e não escreve no diário. É a última
cópia de reparo fora do padrão. Não foi migrada junto porque resolução de
conflito mexe em arquivo em conflito, não em erro de build — semântica própria,
merece olhar dedicado.

**2. Reduzir `maxReajuste()`/`MAX_CONFLICT` para builds cronicamente
instáveis.** Sua decisão sobre o custo de pior caso (US$ 15,52–15,67/card contra
US$ 9,95–10,10 estimados, medido pelo Celer). São quatro pontos de reparo
independentes com teto 2 cada — `testGate`, `buildWithReajuste` pós-teste,
`buildWithReajuste` pós-sync e o laço do item 1 acima — somando 8 chamadas de
agente por card. Falta definir o que conta como "cronicamente instável":
provavelmente um contador por alvo no diário, não uma constante nova.

**3. Ligar `executarEmBlocos` no `implementador`.** `motor/nmy/tjl/blocos.ts`
(item 18) está implementado e testado, mas tem **zero chamadores em `motor/`** —
o ganho de não pagar pela tarefa inteira quando a base já quebrou não está
sendo colhido. A Onda 4 está fechada no sentido de "o módulo existe", não no de
"o motor usa".

---

## Item 25 cobre 2 efeitos externos, e o resto continua fora

`executarComIdempotencia` tem dois chamadores: `pr_create`
(`motor/qlb/ctr/fechar.ts:259`) e `matriz_criada`
(`motor/nmy/luc/matriz-entendimento.ts`). Ficaram de fora `push`
(`motor/qlb/git.ts:188-194`), o laço de conflito de `motor/qlb/ctr/sync.ts` e
qualquer notificação futura.

A Onda 7 achou o modo de falha que torna isso urgente: se a operação **falha**
mas devolve resultado não-vazio, o diário grava `efeito_registrado` para um
efeito que nunca aconteceu — e a chave então impede qualquer nova tentativa
**para sempre**. Foi corrigido na matriz (falha real propaga), mas nada impede
o próximo chamador de repetir o erro. Vale um teste de contrato sobre
`executarComIdempotencia` antes de espalhar mais chamadas.

---

## ESTADO — o que está atrás de `HICODE_RIGOR_ESTRITO=1`

Decidido: **manter como registro**, sem ligar. Três exigências já escrevem o
veredicto no card e só barram com o interruptor ligado:

| Item | Exige | Campo no card |
|---|---|---|
| 5 | perfil `completo` teve teste que FALHOU antes de passar | `red_antes_do_green` |
| 22 | área nova tem comando de teste no contrato do alvo | `setup_ferramental` |
| 4 | matriz de entendimento respondida antes de aprovar o plano | `matriz_entendimento` |

Enquanto desligado dá para ver, card a card, quem passou sem provar — que é o
insumo para decidir quando apertar. Ligar hoje pararia todo trabalho em voo.

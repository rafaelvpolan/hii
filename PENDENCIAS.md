# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## PRÓXIMA ONDA — Onda 11, produção (itens 28, 29, 31, 32)

`Dockerfile` + `docker-compose.yml` sem SDK de nuvem, `core/secrets.ts` com
`EnvSecretProvider` sempre funcional, snapshot do volume, e teto de CPU/memória
por worktree. É a última das ondas dos 32 itens originais. Depois dela ficam a
12 (MCN) e a 13 (TUI).

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

---

## ESTADO — mecanismo pronto sem consumidor, por decisão

Não são pendências: são escolhas registradas para não parecerem esquecimento.

**Item 18 (`executarEmBlocos`).** O laço de `motor/qlb/ctr/fechar.ts` já faz
executa → valida → para cedo. Rotear por TJL ali é cerimônia. O valor real —
fatiar uma implementação em blocos validados — exige fatiador determinístico por
stack, que pertence à camada de skill, não ao `core/`.

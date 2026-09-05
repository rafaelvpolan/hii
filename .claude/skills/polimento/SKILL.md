---
name: polimento
description: "Roda o passo de arquitetura/polimento (rufus) de um card do hii que está em pipeline manual (PAUSED após a url aprovada). Apelido de `/arquitetura`. Use quando o usuário disser 'polimento', 'roda o polimento do card', '/polimento' ou '/hii:code:polimento'."
user-invocable: true
argument-hint: "[id do card]"
---

# /polimento — passo de arquitetura do pipeline manual do hii

Rode no terminal:

```sh
hii passo <id> polimento
```

Sem `<id>` nos argumentos ($ARGUMENTS), descubra o card pausado com `hii estado --compacto` (procure status `PAUSED` com `pipeline_pausa: manual`) e confirme com o usuário antes de disparar.

O comando só grava o pedido no card — quem executa é o daemon do hii (`hii start`), com os mesmos gates e contabilidade de qualquer passo. Se o daemon estiver offline, avise que o passo vai rodar quando ele subir. Depois do passo, o card volta a PAUSED; os demais passos são `/testes`, `/seguranca`, `/limpeza`, e `/hii` roda tudo de uma vez e fecha (build, gates e PR).

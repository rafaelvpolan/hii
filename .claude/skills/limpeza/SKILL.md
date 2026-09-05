---
name: limpeza
description: "Roda o passo de limpeza (pura — remove prosa de comentários do diff) de um card do hii em pipeline manual. Use quando o usuário disser 'limpeza do card', 'roda a limpeza', '/limpeza' ou '/hii:code:limpeza'."
user-invocable: true
argument-hint: "[id do card]"
---

# /limpeza — passo de limpeza do pipeline manual do hii

Rode no terminal:

```sh
hii passo <id> limpeza
```

Sem `<id>` nos argumentos ($ARGUMENTS), descubra o card pausado com `hii estado --compacto` (status `PAUSED` com `pipeline_pausa: manual`) e confirme com o usuário antes de disparar.

O passo depende de `testes` e `seguranca` já terem rodado (o motor recusa e avisa se faltar). Quem executa é o daemon do hii. Depois, o card volta a PAUSED — se era o último passo, `/hii` (ou ENTER no card na TUI) fecha: build, gates e PR.

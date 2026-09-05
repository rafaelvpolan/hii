---
name: testes
description: "Roda o passo de testes (testudo, com gate de suite verde) de um card do hii em pipeline manual. Use quando o usuário disser 'testes do card', 'roda os testes do card', '/testes' ou '/hii:code:testes'."
user-invocable: true
argument-hint: "[id do card]"
---

# /testes — passo de testes do pipeline manual do hii

Rode no terminal:

```sh
hii passo <id> testes
```

Sem `<id>` nos argumentos ($ARGUMENTS), descubra o card pausado com `hii estado --compacto` (status `PAUSED` com `pipeline_pausa: manual`) e confirme com o usuário antes de disparar.

O passo depende de `arquitetura` já ter rodado (o motor recusa e avisa se faltar). Quem executa é o daemon do hii, com o gate de testes do projeto. Depois, o card volta a PAUSED — restam `/seguranca`, `/limpeza`, ou `/hii` para rodar tudo e fechar.

---
name: seguranca
description: "Roda o passo de segurança (escudo — OWASP, secrets, deps) de um card do hii em pipeline manual. Use quando o usuário disser 'segurança do card', 'revisa a segurança', '/seguranca' ou '/hii:code:seguranca'."
user-invocable: true
argument-hint: "[id do card]"
---

# /seguranca — passo de segurança do pipeline manual do hii

Rode no terminal:

```sh
hii passo <id> seguranca
```

Sem `<id>` nos argumentos ($ARGUMENTS), descubra o card pausado com `hii estado --compacto` (status `PAUSED` com `pipeline_pausa: manual`) e confirme com o usuário antes de disparar.

O passo depende de `arquitetura` já ter rodado (o motor recusa e avisa se faltar). Quem executa é o daemon do hii. Depois, o card volta a PAUSED — restam `/testes` (se ainda não rodou), `/limpeza`, ou `/hii` para rodar tudo e fechar.

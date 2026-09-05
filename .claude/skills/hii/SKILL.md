---
name: hii
description: "Roda a suite completa de dev de um card do hii em pipeline manual: todos os passos restantes (arquitetura, testes, seguranca, limpeza) em sequência, e segue para o fecho — build, gates, push e PR. Use quando o usuário disser '/hii', 'roda a suite do card', 'executa o pipeline todo' ou 'fecha o card'."
user-invocable: true
argument-hint: "[id do card]"
---

# /hii — suite completa do pipeline manual

Rode no terminal:

```sh
hii pipeline <id>
```

Sem `<id>` nos argumentos ($ARGUMENTS), descubra o card pausado com `hii estado --compacto` (status `PAUSED` com `pipeline_pausa: manual`) e confirme com o usuário antes de disparar.

Passos já rodados individualmente (`/polimento`, `/testes`, ...) NÃO são pagos de novo — o motor lê `pipeline_feitos` do card e roda só o que falta. Quem executa é o daemon do hii (`hii start`); se estiver offline, avise que a suite roda quando ele subir. Ao final o motor abre o PR — merge é sempre humano.

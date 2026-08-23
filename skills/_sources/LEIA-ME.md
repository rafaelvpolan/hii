# `_sources/` — adaptações de catálogos externos

Uma pasta por origem (`ecc/`, `wshobson-agents/`, `maestro/`, `omc/`), cada uma com:

- `ORIGIN.json` — repo, commit importado, licença, data, quem adaptou
- `LICENSE.txt` — cópia da licença original (MIT e Apache-2.0 exigem atribuição)
- os packs, no mesmo formato de `_native/`

**O que entra aqui é o texto de instrução, adaptado.** Nunca hook, script ou
dependência de runtime do projeto de origem — o motor do `hii` continua sendo o
único que decide ciclo de vida.

**O `trigger` nunca sai do import automático.** Quando uma skill deve carregar
é julgamento humano, revisado — igual às nativas.

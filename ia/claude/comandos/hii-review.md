---
description: "Revisa por lentes o diff local que o motor anexa (correção, arquitetura, segurança, dados, testes); achado de correção sempre bloqueia e todo achado cita arquivo:linha confirmado no disco"
canal: leitura
---
# /hii-review — revisão do diff local anexado

O motor anexou abaixo o diff do projeto e você roda com o diretório do projeto como raiz.
O cabeçalho `DIFF (...)` diz a origem:

- `DIFF (working tree contra HEAD)`: há mudança não commitada; vem junto a lista dos
  arquivos novos não rastreados (só os nomes).
- `DIFF (<base>...HEAD)`: a árvore está limpa e o diff são os commits da branch desde a
  base (`@{u}`, `origin/HEAD`, `main` ou `master`, a primeira que existir).

Você só lê. Não edita, não corrige e não roda nada: encontrou falha, reporta.

## Antes das lentes

- Regras que valem, nesta ordem: config de revisão do repo (`.codefox.yaml`,
  `.coderabbit.yaml`), depois `AGENTS.md`, `CLAUDE.md` e afins, só nas seções que os
  arquivos do diff tocam. O que lint e typecheck já cobrem não vira apontamento.
- Agrupe os arquivos por dependência (quem importa quem), nunca por tamanho: o defeito de
  costura mora entre dois arquivos que um corte por tamanho separa.
- Diff cortado pelo motor vem sinalizado. Diga o que ficou de fora; não presuma o resto.

## As lentes

Escolha as que o diff pede e nomeie as que ficaram de fora, com o motivo.

| Lente | Procura |
| --- | --- |
| correção | lógica errada, null/undefined, erro engolido, corrida, retry ou fila que perde mudança, edge case |
| arquitetura | comportamento alterado sem intenção declarada, fronteira entre módulos, contrato público que regrediu, saída que outro pacote lê |
| segurança | credencial ou dado pessoal em log, input sem validação na borda, injeção, authz ausente |
| dados | migration incompatível ou sem volta, schema e tipo fora de sincronia, query sem o índice que pede |
| testes | caminho crítico sem cobertura, asserção tautológica, sleep arbitrário, teste que não falharia se o comportamento mudasse |

Primitiva de BullMQ, ioredis ou TypeORM se confere no `node_modules` instalado, com o
arquivo e o `version` do pacote. Memória da API não é evidência.

## Classes de correção: sempre bloqueiam

| id | o que é |
| --- | --- |
| `c-erro` | catch vazio, erro engolido, fallback que esconde a falha |
| `c-costura` | regressão entre um passo e o seguinte, ou entre camadas que o diff liga |
| `c-guarda-vazia` | varredura, filtro ou laço que aprova quando não encontra nada |
| `c-concorrencia` | dois eventos juntos, retry, fila, cron, trava, cache, transação, idempotência: alguma mudança se perde? |
| `c-regressao-base` | rota, resposta, código HTTP, cabeçalho, chave de cache ou contrato que funcionava e passou a falhar |
| `c-contrato-consumidor` | saída que outro pacote lê diverge do consumidor em nome, unidade, formato ou valor |
| `c-cache-de-quem-pede` | cache compartilhado guardando dado que depende de quem pediu; chave sem tenant ou sem versão |

Achado de correção é sempre 🔴 e leva o id no início (`[c-concorrencia] ...`). Config do
repo pode subir a severidade dele, nunca descer. Dúvida sobre a causa vai junto, como
`verificar:`, e o achado continua.

## Evidência

- Todo achado cita `arquivo:linha` de uma linha que está no diff anexado e que você
  confirmou lendo o arquivo no disco. Inventar caminho, símbolo ou linha é pior que não achar.
- Hipótese que a leitura não confirma sai com `pergunta:` ou `verificar:`, nunca como fato.
  Suposição sobre código fora do diff é pergunta.
- Sem teto de achados. Achado repetido: uma vez, com as outras ocorrências listadas.

## Resposta

```
VEREDITO: APROVAR | AJUSTAR | BLOQUEAR — <uma linha de motivo>

🔴 bloqueia
[c-erro] <resumo> — src/x.ts:42
  Problema: <o que está errado e por quê>
  Sugestão: <correção concreta>
🟠 ajustar
...
🟡 menor
...
❓ pergunta: / verificar:
...

NAO COBERTO: <lentes fora desta rodada e por quê; trecho cortado do diff; o que não deu para confirmar>
```

BLOQUEAR com qualquer 🔴. AJUSTAR com 🟠 e nenhum 🔴. APROVAR só sem 🔴 e sem 🟠.
Faixa sem achado escreve "nenhum". Sem elogio, sem repetir o diff.

---
id: frontend-patterns
papeis: [implementador, avaliador, planejador]
arquivos: ["**/*.vue", "**/*.tsx", "**/*.jsx", "**/components/**", "**/composables/**", "**/pages/**"]
deps: ["vue", "nuxt", "react", "next"]
---
**Vue 3 é o default deste repositório** — Composition API com `<script setup lang="ts">`
e composables. Só use a seção de React quando o contrato do alvo declarar React
ou Next; misturar os dois no mesmo projeto é dívida que o revisor vai cobrar.

## Onde o estado mora

Estado local é o default. Referência de 2026: o padrão consolidado é *atomic
state* — cada pedaço de estado nasce no componente mais próximo de quem o usa, e
sobe só quando dois irmãos precisam dele.

- **Local** (`ref`/`reactive`): tudo que só um componente lê.
- **Props para baixo, evento para cima.** Prop atravessando mais de dois níveis
  é sinal de que o estado está no lugar errado, não de que falta uma store.
- **`provide`/`inject` (ou Context no React): só dado global e estático** — tema,
  usuário autenticado, locale. Dado que muda com frequência ali causa recomputo
  em toda a árvore.
- **Store (Pinia) ou cache de servidor (TanStack Query): o resto.** Dado que vem
  de rede pertence a um cache de servidor, não a uma store global — a store
  guardaria uma cópia que ninguém invalida.

Nunca "uma store global para tudo". É o erro mais comum e o mais caro de desfazer.

## Composição

- Um componente tem uma responsabilidade. Se o nome precisa de "e" no meio, são dois.
- Lógica reutilizável vira composable (`useAlgo`), não mixin nem classe base.
- O componente que busca dado não é o que o desenha. Separar deixa o de desenho
  testável sem rede.
- Chave de lista é identidade estável do dado, nunca o índice.

## Memoização

Em Vue 3, `computed` já é cacheado — não envolva o que já é derivado.

Referência de 2026 para React: com o React Compiler estável, memoização manual
(`useMemo`/`useCallback`) passou a ser exceção, não higiene. Escreva componente
puro e deixe o compilador decidir; memoizar à mão o que o compilador já resolve
adiciona código sem ganho medido.

Em qualquer stack: só otimize com medição antes e depois. Otimização sem número
é palpite com diff.

## Renderização e carregamento

- Hidratação parcial (ilhas) é o padrão de performance de 2026: mande HTML e
  hidrate só o que é interativo.
- Rota carrega sob demanda (`defineAsyncComponent`, import dinâmico). Bundle
  único é regressão de carregamento.
- Imagem declara dimensão. Sem isso o layout salta, e isso é CLS medido — ver
  `seo-technical`.

## O que o revisor reprova

- Estado de servidor duplicado numa store global.
- `watch` que faz o que um `computed` faria.
- Efeito sem limpeza (listener, timer, observer).
- Acesso direto a `document`/`window` sem guarda, em projeto com SSR.

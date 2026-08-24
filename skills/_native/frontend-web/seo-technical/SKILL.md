---
id: seo-technical
papeis: [implementador, avaliador, planejador]
arquivos: ["**/*.vue", "**/*.html", "**/pages/**", "**/routes/**", "**/robots.txt", "**/sitemap*", "**/nuxt.config.*", "**/vite.config.*"]
deps: ["vue", "nuxt", "react", "next", "vite"]
---
SEO técnico é o que se verifica no HTML entregue e em número medido — não é
escolha de palavra.

## Core Web Vitals são meta objetiva, não impressão

Desde 2024 o INP substituiu o FID como métrica oficial de interação. Em 2026 os
três limiares de "bom", no percentil 75 de visitas reais:

- **INP ≤ 200 ms** (resposta à interação)
- **LCP ≤ 2,5 s** (maior elemento de conteúdo pintado)
- **CLS ≤ 0,1** (deslocamento de layout acumulado)

Trate isso como gate: número medido em campo, com antes e depois. "Ficou mais
rápido" sem medida não conta como melhoria — é a mesma classe de afirmação que
nenhum gate deste motor aceita.

O que mais move cada um, na prática:
- **LCP**: imagem herói sem dimensão declarada, fonte bloqueando pintura, e
  bundle de rota grande demais.
- **CLS**: imagem e iframe sem `width`/`height`, banner injetado acima do
  conteúdo, fonte trocando com métrica diferente (use `font-display: swap` mais
  fallback com métricas próximas).
- **INP**: trabalho longo na thread principal durante o clique; quebre em
  tarefas ou mova para worker.

## Por rota, e único

- `<title>` e `<meta name="description">` próprios de cada rota. Em SPA, isso
  precisa ser atualizado na navegação — título que não muda é rota que não indexa.
- `<link rel="canonical">` apontando para a URL preferida, absoluta.
- Open Graph (`og:title`, `og:description`, `og:image`) para o cartão de
  compartilhamento; sem `og:image` o link vira caixa vazia.
- `<html lang>` correto — afeta indexação e leitor de tela.

## Rastreio

- `robots.txt` não bloqueia CSS nem JS: sem eles o rastreador não renderiza a
  página e avalia layout quebrado.
- `sitemap.xml` lista só URL canônica que devolve 200.
- Conteúdo que importa vive no HTML entregue. O que só aparece depois de uma
  chamada de rede pode não ser indexado.

## Dado estruturado

JSON-LD com `@type` adequado, e **coerente com o que está visível na página**.
Marcar avaliação, preço ou autor que a página não mostra é violação de diretriz e
custa a rich snippet inteira.

## O que o revisor reprova

- Título duplicado entre rotas.
- Imagem sem dimensão declarada em página com conteúdo acima da dobra.
- `noindex` esquecido em produção depois de um ambiente de teste.
- Heading usado por tamanho de fonte em vez de hierarquia — ver
  `accessibility-a11y`.

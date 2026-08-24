---
id: accessibility-a11y
papeis: [implementador, avaliador]
arquivos: ["**/*.vue", "**/*.tsx", "**/*.jsx", "**/*.html", "**/components/**", "**/pages/**"]
deps: ["vue", "nuxt", "react", "next"]
---
Checklist WCAG aplicável a qualquer stack de front. A referência é a **WCAG 2.2**
(recomendação W3C de outubro de 2023, base das exigências legais em vigor em
2026), e o que está aqui é a parte **verificável** dela.

## Semântica antes de ARIA

O primeiro atributo ARIA de um componente costuma ser sinal de que o elemento
errado foi escolhido.

- Ação que navega é `<a href>`. Ação que muda estado é `<button>`. `div` com
  `@click` não recebe foco, não responde a Enter e não é anunciada.
- Estrutura por `<main>`, `<nav>`, `<header>`, `<footer>`, `<section>` com nome.
- Título de nível não pula: um `h1` por página, e `h3` só depois de um `h2`.
- ARIA só quando não existe elemento nativo equivalente. `aria-label` não
  conserta elemento errado, apenas dá nome a ele.

## Teclado

- Todo elemento interativo é alcançável por Tab, na ordem visual.
- Foco tem indicador **visível**. Remover o anel de foco sem substituir por um
  próprio é a falha de acessibilidade mais comum em código de produção.
- Modal prende o foco enquanto aberta, devolve para quem a abriu ao fechar, e
  fecha com Esc.
- `tabindex` positivo desalinha a ordem do documento — use `0` ou `-1`.

## Formulário

- Todo campo tem `<label>` associado por `for`/`id`. Placeholder não é rótulo:
  desaparece ao digitar.
- Erro é ligado ao campo (`aria-describedby`) e anunciado, não só pintado de
  vermelho.
- Campo obrigatório é marcado no código (`required`), não apenas com asterisco.

## Cor e contraste

- Contraste mínimo 4,5:1 para texto normal, 3:1 para texto grande e para
  elemento de interface.
- **Nenhuma informação depende só de cor.** Erro em vermelho precisa de ícone ou
  texto; série de gráfico precisa de rótulo ou padrão.

## Conteúdo que muda sozinho

- Resultado assíncrono (busca, salvamento) é anunciado por região viva
  (`aria-live="polite"`), senão quem usa leitor de tela não sabe que algo mudou.
- Nada pisca mais de três vezes por segundo.
- Animação respeita `prefers-reduced-motion`.

## Novo na 2.2, e cobrado

- **Tamanho de alvo** mínimo de 24x24 CSS px para controle apontável, ou
  espaçamento equivalente.
- Foco não pode ficar **escondido** atrás de barra fixa ou cabeçalho pegajoso.
- Autenticação não exige que a pessoa memorize ou transcreva algo (permita colar
  no campo de senha e de código).

## Imagem

`alt` descreve a função da imagem no contexto. Imagem decorativa recebe `alt=""`
— e é isso que a diferencia de uma imagem sem `alt`, que o leitor de tela lê
pelo nome do arquivo.

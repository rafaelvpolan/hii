# Pendências

O que ficou em aberto, com o porquê e onde mexer. Ordem = o que dói primeiro.

Quando um item sair, apague a seção — este arquivo é lista de trabalho, não histórico.

---

## 1. Clipboard: só o caminho do WSL foi verificado de verdade

`colarImagem` (`lib/runner/clipboard.ts`) tem quatro backends. Verificado em execução real **apenas o
WSL** (`powershell.exe Get-Clipboard -Format Image` + `wslpath`), pondo uma imagem no clipboard do
Windows e conferindo o PNG em disco. `wl-paste` (Wayland), `xclip` (X11) e `pngpaste` (macOS) estão
cobertos **só por teste com mock** — esta máquina não tem nenhum dos três instalados.

**O que fazer:** rodar `hii` numa máquina Linux com Wayland ou X11 e num mac, e conferir
`/ref clipboard` de ponta a ponta. Até então, tratar esses três como não verificados.

---

## 2. Painel: push em vez de polling (se e quando doer)

O contrato de hoje é polling barato: o painel guarda `hii estado --revisao` e só relê o snapshot quando
o token vira. Serve, é local, e não acrescenta processo nem porta ao motor.

**Só fazer se o polling doer de verdade.** Seria SSE/HTTP em cima do mesmo snapshot, sem mudar o
contrato — e traz servidor, porta e superfície de auth para dentro do motor, o que contraria o escopo
(execução, revisão, verificação e roteador de IAs).

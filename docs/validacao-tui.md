# Validacao do Motor pelo TUI

O TUI e o daemon continuam independentes do Hicode e de `hii api`.
Esta auditoria exercita teclado, tela, persistencia, gateway e harnesses locais
simulados. Nao requer conexao HTTP com o painel nem chamadas de IA paga.

## Camadas de prova

| Camada | O que a prova observa | Testes |
| --- | --- | --- |
| Entrada e layout | Teclas, colagem, historico, ANSI, rolagem, larguras e carga | `test/mirante/tui-*.test.ts`, `percurso-completo.test.ts` |
| Callbacks de producao | A mesma funcao `tui` de `bin/repl.ts`, nao uma copia de seus callbacks | `test/mirante/tui-motor-integrado.test.ts` |
| Motor e streaming | Gateway e roteador reais, Codex CLI falso em subprocesso, Claude simulado, arquivos e subsessions persistidos | `test/mirante/tui-motor-integrado.test.ts` |
| Terminal Linux | Pseudoterminal de `script`, `nodeTerminal`, stdin real, raw mode, tela alternativa e estado escrito por outro processo | `test/mirante/tui-pty.test.ts` |
| E2E visual | Teclado Playwright, xterm.js, PTY Linux, TUI real e gateway/roteador; screenshots, transcript e trace | `test/mirante/e2e/tui-playwright.mjs` |
| Ciclo da interface | Fila de comandos, erros, repintura apos promessa e encerramento | `test/mirante/tui-ciclo-de-vida.test.ts` |
| Protocolo do Codex | Saida antes do fim, erros aninhados, exit codes 0/1 e raias de log | `test/tomada/codex-live-stream.test.ts` |
| Daemon e orquestracao | Fila, reinicio, harness sobrevivente, pipeline, gates, evidencias e retomada | `test/oswaldo/`, `test/ciclo/`, `test/quilombo/` |

Nos testes integrados, as assercoes de tela usam o resultado reconstruido dos
frames ANSI. Nao basta encontrar uma mensagem no arquivo de log ou no estado
interno. A interface e observada enquanto a chamada ainda esta em andamento e
depois da conclusao, em terminais de 48 e 100 colunas.

## Cenarios integrados

- `/new` cria uma session; pedidos seguintes ficam encadeados nela.
- Codex escreve texto visivel antes de encerrar seu subprocesso.
- Cota do Codex causa falha visivel seguida de troca automatica para Claude.
- O novo provedor recebe o pedido original e a instrucao de continuidade;
  o arquivo parcial sobrevive, sem reiniciar a tarefa.
- As subsessions registram os provedores e a execucao chega a `COMPLETED`;
  o rodape deixa de anunciar trabalho em andamento.
- `/ask` responde sem criar execucao, inclusive depois de um log longo.
- `CLARIFY` surgindo durante o acompanhamento abre pergunta com opcoes.
- Digitar o numero de uma tarefa com pergunta abre a pergunta, nao aprova o plano.
- `CONFIRM` oferece encerrar e abrir PR ou informar o que falta, sem prometer
  repetir polimento. O teste confirma apenas a transicao, nao abre PR externo.
- `Ctrl+C` interrompe, Enter retoma e Esc sai do acompanhamento sem cancelar.
- `/new` descarta pendencias antigas de remocao, resposta e retomada.
- Tab no board troca o projeto e solta a tarefa e o contexto locais anteriores.
- `/hii tarefa.spec` registra pedido orquestrado; texto comum seguinte usa gateway.
- Spec inexistente nao cria execucao. Session com pedido pendente nao fecha;
  depois do fechamento persistido o historico mostra `#id closed`.
- `/ia` e `/model` exibem catalogo e indicadores; Page Up permite rever a lista.
- `/model 1` persiste o modelo; Shift+Tab alterna modos validos do Codex;
  `/config` abre e Esc devolve a entrada.
- Daemon offline e anunciado; a tarefa fica enfileirada, nao e dada como executada.
- Sair restaura o terminal e descarta comandos ainda nao iniciados na fila da TUI.

## Falhas corrigidas nesta auditoria

1. **Pendencia de exclusao atravessava `/new`.** Texto da conversa nova podia
   confirmar a remocao antiga. Trocar de tarefa ou sair dela agora limpa as
   pendencias locais; escolher outro projeto tambem limpa a conversa local.
2. **Pergunta tardia ficava invisivel.** A sincronizacao observava apenas perguntas
   do crivo. Agora usa a consulta unificada de pendencias, incluindo `CLARIFY`.
3. **Numero da tarefa ignorava a pergunta.** O despacho mostrava o plano mesmo
   com pergunta aberta. Agora prioriza a pergunta e normaliza o ID antes de le-la.
4. **`CONFIRM` nao abria o painel correto.** A deteccao automatica e os textos
   agora distinguem confirmacao final de aprovacao de URL.
5. **Falha do Codex deixava chamada visual aberta.** O harness agora grava um
   marcador terminal de falha, reconhecido pela linha do tempo e pelo renderizador.
   A mensagem de `turn.failed.error.message` e preservada para classificar a cota,
   inclusive quando o processo sai com codigo zero.
6. **Raias do Codex separavam cabecalho e corpo.** O cabecalho recebe o mesmo
   prefixo da atividade e do encerramento.
7. **Resposta de `/ask` sumia acima da execucao.** Consultas sao apresentadas
   depois do corpo rolante; erros de comandos tambem ficam nessa area visivel.
8. **Comando assincrono deixava quadro antigo.** A conclusao invalida o cache
   visual antes de repintar, sem depender do proximo tick.
9. **Fila continuava depois da saida.** Comandos ainda nao iniciados e repinturas
   sao bloqueados ao encerrar a TUI. Trabalho ja enviado ao daemon nao e cancelado.
10. **Esc nao cumpria a dica da tarefa.** Agora sai do acompanhamento ou dispensa
    a pergunta, respeitando a navegacao do board.
11. **Resposta ao crivo anunciava retomada inexistente.** O log agora distingue
    uma resposta registrada de uma execucao efetivamente retomada.
12. **Historico sumia depois de conversas longas.** `/historico` agora limpa o
    log transitorio ao trocar de tela, sem apagar mensagens persistidas. O E2E
    visual reproduziu o defeito: os logs escondiam a session fechada.
13. **Primeira seta no `/config` nao mudava a selecao visivel.** A navegacao agora
    parte do mesmo primeiro provedor que o painel realca quando a selecao interna
    esta vazia ou pertence a outra tela. O E2E exige que uma seta abra o Codex e
    confirme `on-request` depois de Shift+Tab.

## E2E visual com Playwright

```bash
bun install --frozen-lockfile
bunx playwright install chromium
bun run test:tui:e2e
# Destino opcional:
bun run test:tui:e2e /tmp/hii-tui-visual
```

O fluxo e **teclado do navegador -> xterm.js -> stdin do PTY -> TUI de producao
-> gateway/roteador -> ANSI -> xterm.js -> screenshot**. Nao e uma pagina que
imita o TUI, nem uma captura reconstruida a partir de mensagens esperadas.
O driver espera texto no buffer efetivamente renderizado e confere o estado
persistido entre processos. Nao usa pausas fixas para adivinhar quando a tela
ficou pronta. Os controles de liberacao do harness simulado permitem observar
streaming e fallback antes da conclusao.

Dois percursos completos, em **48x36 e 100x36**, capturam 12 etapas cada:
inicio, streaming Codex, falha e troca, conclusao, `/ask`, pergunta, interrupcao,
confirmacao final, session fechada, modelos, IAs e configuracao. Incluem teclas
numericas sem Enter, Ctrl+C, retomada, Shift+Tab, Esc e saida limpa.

Artefatos no destino escolhido:

- `processo-orquestracao.html`: o **visualizador existente**, com as capturas
  incorporadas na aba TUI / E2E, navegacao por etapa e transcript.
- `capturas.json`: importavel na mesma aba de `docs/processo-orquestracao.html`.
- `*.png` e `*.txt`: imagem e texto de cada etapa, incluindo a tela da falha
  quando uma assercao reprovar; `terminal-*.ansi`: stream bruto para diagnostico.
- `trace-48.zip` e `trace-100.zip`: traces do Playwright, abrindo com
  `bunx playwright show-trace /tmp/hii-tui-visual/trace-48.zip`.

O replay tambem e testado em 390 e 1365 pixels: navegacao, importacao, texto
literal sem injecao HTML, rejeicao de URLs externas, imagens nao vazias por
leitura de pixels e ausencia de overflow horizontal. Sao **24 screenshots**
do terminal mais duas do replay. Nao ha baseline de comparacao pixel a pixel:
timestamps e indicadores variam; assercoes comportamentais e revisao das
capturas complementam os checks geometricos. Use um destino novo por rodada
para nao confundir artefatos antigos com o resultado atual.

O job `tui-visual` do CI executa esse gate separadamente e publica os artefatos
por sete dias, inclusive quando falha. O teste requer Linux, Node 24, `script`,
`stty` e Chromium; xterm.js e apenas dependencia de desenvolvimento.

## Reproduzir

Resultado desta rodada: **3.147 testes aprovados no Bun (311 arquivos)** e
**3.141 no Node (3.111 na etapa principal + 30 isolados)**, sem falhas.
Foram adicionados 17 testes. Typecheck, lint de tipos, lint de clone e verificacao
de whitespace tambem passaram. As duas trilhas executam a regressao PTY.

Suite completa, com isolamento por arquivo e validacao nos dois runtimes:

```bash
HII_TEST_JOBS=4 bun run test
```

Diagnostico dirigido (rode cada arquivo em processo separado):

```bash
bun test --timeout 20000 test/mirante/tui-motor-integrado.test.ts
bun test test/mirante/tui-ciclo-de-vida.test.ts
bun test test/tomada/codex-live-stream.test.ts
bun test --timeout 30000 test/mirante/tui-pty.test.ts
node --test --test-timeout=30000 test/mirante/tui-pty.test.ts
```

O teste PTY requer Linux com `script` e `stty` (util-linux/coreutils), presentes
no ambiente de CI Ubuntu. A fixture `test/fixtures/tui-processo.ts` exige caminhos
de estado isolados e nao deve ser usada como entrada operacional do motor.

## Limites

- Suite verde nao prova ausencia de todos os bugs nem equivale a 100% de cobertura.
- O teste PTY chama a TUI de producao diretamente: o bootstrap interativo de
  selecao de projeto/preflight e coberto separadamente, nao por essa fixture.
- Os novos testes nao usam contas pagas, autenticacao real nem servicos de IA.
  Mudancas futuras nos CLIs externos podem exigir atualizar os contratos.
- O teste integrado conduz o gateway diretamente; o daemon e a recuperacao de
  subprocessos possuem suas proprias suites. Nao se afirma uma execucao paga
  ponta a ponta em producao.
- O E2E visual tambem usa agendamento controlado e harnesses simulados. Cobrir
  o terminal com Playwright nao valida autenticacao externa, o daemon completo
  nem todos os emuladores de terminal. O fechamento do PR e apenas uma transicao
  local no teste, sem publicar PR em nome de uma tarefa simulada.
- O fechamento da session usa o mecanismo existente, disponivel pelo CLI
  `hii pipeline close <session> --repo <owner/nome>`; nao foi criado `/close`.
- Kimi e migracao do adapter Hicode nao foram alterados nesta auditoria.

Contrato separado para clientes externos: [conexao Hicode/motor](conexao-hicode/README.md).

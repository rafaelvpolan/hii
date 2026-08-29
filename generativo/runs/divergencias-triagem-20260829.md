# Divergencias de triagem entre qwen2.5-coder:7b e qwen3:8b (3o ciclo, 2026-08-29)

77/88 linhas validas do qwen3:8b entraram no cruzamento (11 sairam do formato).
Concordam em 27, divergem em 46 — revisao humana decide.

```
motor/agentes/clarice/doc-updater.ts                    coder=A qwen3=C
motor/agentes/tarsila/design.ts                         coder=A qwen3=B
motor/agentes/vital/auditoria-harness.ts                coder=A qwen3=B
motor/cascudo/freire/assinatura.ts                      coder=A qwen3=C
motor/cordel/alicerce/snapshot.ts                       coder=A qwen3=C
motor/cordel/arquivar.ts                                coder=B qwen3=C
motor/cordel/frontmatter.ts                             coder=B qwen3=C
motor/cordel/repos.ts                                   coder=B qwen3=C
motor/cordel/util.ts                                    coder=B qwen3=A
motor/euclides/eventos.ts                               coder=B qwen3=C
motor/euclides/radar/progresso.ts                       coder=A qwen3=C
motor/euclides/radar/saude.ts                           coder=A qwen3=C
motor/euclides/radar/tick.ts                            coder=B qwen3=C
motor/euclides/registros.ts                             coder=B qwen3=C
motor/euclides/sessao.ts                                coder=B qwen3=C
motor/euclides/tesouro/janelas.ts                       coder=A qwen3=C
motor/euclides/tesouro/lacuna.ts                        coder=A qwen3=C
motor/mirante/acoes.ts                                  coder=B qwen3=A
motor/mirante/cli/comandos.ts                           coder=B qwen3=C
motor/mirante/cli/dados.ts                              coder=B qwen3=C
motor/mirante/cli/rodape-tui.ts                         coder=B qwen3=C
motor/mirante/cli/saida.ts                              coder=B qwen3=C
motor/mirante/cli/situacao-cli.ts                       coder=B qwen3=C
motor/mirante/cli/tela-tarefa.ts                        coder=B qwen3=C
motor/mirante/comandos-de-tarefa.ts                     coder=B qwen3=A
motor/mirante/estado-json.ts                            coder=A qwen3=C
motor/mirante/refs-comando.ts                           coder=B qwen3=C
motor/mirante/render/config/paineis.ts                  coder=B qwen3=C
motor/mirante/watch.ts                                  coder=B qwen3=C
motor/oswaldo/mutirao/encerramento.ts                   coder=B qwen3=A
motor/oswaldo/mutirao/fila.ts                           coder=A qwen3=C
motor/oswaldo/rui.ts                                    coder=B qwen3=A
motor/quilombo/alfandega/anexo.ts                       coder=A qwen3=C
motor/quilombo/alfandega/ipv4.ts                        coder=B qwen3=C
motor/quilombo/alfandega/refs.ts                        coder=A qwen3=C
motor/quilombo/cartorio/merge.ts                        coder=B qwen3=A
motor/quilombo/cartorio/pr.ts                           coder=A qwen3=C
motor/quilombo/cartorio/retomar.ts                      coder=B qwen3=A
motor/quilombo/cofre/segredos.ts                        coder=A qwen3=C
motor/quilombo/limites.ts                               coder=B qwen3=A
motor/tomada/catalogo.ts                                coder=A qwen3=C
motor/tomada/harness/claude-stream.ts                   coder=B qwen3=C
motor/tomada/harness/ollama.ts                          coder=B qwen3=C
motor/tomada/ponte/tarefas/sync.ts                      coder=B qwen3=C
motor/tomada/preferencias.ts                            coder=A qwen3=C
motor/tomada/sonda.ts                                   coder=B qwen3=C
```

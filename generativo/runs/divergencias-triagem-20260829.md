# Divergencias de triagem entre qwen2.5-coder:7b e qwen3:8b (4o ciclo, 2026-08-29)

88/88 validas nos dois modelos. Concordam em 44, divergem em 44 — revisao humana decide.

```
motor/agentes/tarsila/design.ts                         coder=A qwen3=B
motor/agentes/tarsila/ideate-run.ts                     coder=A qwen3=B
motor/agentes/vital/auditoria-harness.ts                coder=A qwen3=B
motor/cascudo/freire/assinatura.ts                      coder=A qwen3=C
motor/cascudo/memoria.ts                                coder=B qwen3=C
motor/ciclo/canudos/gauntlet.ts                         coder=A qwen3=B
motor/ciclo/crivo/perguntas-do-crivo.ts                 coder=A qwen3=B
motor/ciclo/crivo/portoes-de-fecho.ts                   coder=A qwen3=B
motor/ciclo/reparo.ts                                   coder=A qwen3=B
motor/ciclo/reprise/espera.ts                           coder=A qwen3=B
motor/ciclo/reprise/reparadores/tipos.ts                coder=A qwen3=B
motor/ciclo/reprise/tentativas.ts                       coder=A qwen3=B
motor/cordel/alicerce/snapshot.ts                       coder=A qwen3=C
motor/cordel/arquivar.ts                                coder=B qwen3=C
motor/cordel/frontmatter.ts                             coder=B qwen3=C
motor/cordel/repos.ts                                   coder=B qwen3=C
motor/cordel/texto.ts                                   coder=A qwen3=C
motor/euclides/eventos.ts                               coder=B qwen3=A
motor/euclides/radar/saude.ts                           coder=A qwen3=B
motor/euclides/radar/servidor.ts                        coder=C qwen3=B
motor/euclides/registros.ts                             coder=B qwen3=A
motor/euclides/tesouro/cota-runs.ts                     coder=A qwen3=B
motor/mirante/acoes.ts                                  coder=B qwen3=A
motor/mirante/cli/dados.ts                              coder=B qwen3=C
motor/mirante/cli/saida.ts                              coder=B qwen3=C
motor/mirante/estado-json.ts                            coder=A qwen3=C
motor/mirante/render/config/tipos.ts                    coder=A qwen3=B
motor/mirante/watch.ts                                  coder=B qwen3=C
motor/niemeyer/passos.ts                                coder=A qwen3=B
motor/niemeyer/tijolo/blocos.ts                         coder=A qwen3=B
motor/oswaldo/mutirao/fila.ts                           coder=A qwen3=B
motor/quilombo/alfandega/anexo.ts                       coder=A qwen3=C
motor/quilombo/alfandega/ipv4.ts                        coder=B qwen3=C
motor/quilombo/alfandega/refs.ts                        coder=A qwen3=B
motor/quilombo/cartorio/merge.ts                        coder=B qwen3=A
motor/quilombo/cartorio/retomar.ts                      coder=B qwen3=A
motor/quilombo/cofre/segredos.ts                        coder=A qwen3=C
motor/quilombo/limites.ts                               coder=B qwen3=A
motor/tomada/catalogo.ts                                coder=A qwen3=B
motor/tomada/harness/claude-stream.ts                   coder=B qwen3=C
motor/tomada/harness/ollama.ts                          coder=B qwen3=C
motor/tomada/modo-puro.ts                               coder=A qwen3=B
motor/tomada/ponte/tarefas/tipos.ts                     coder=A qwen3=B
motor/tomada/preferencias.ts                            coder=A qwen3=B
```

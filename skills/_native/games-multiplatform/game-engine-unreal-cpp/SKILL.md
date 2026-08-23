---
id: game-engine-unreal-cpp
papeis: [implementador, reparador, avaliador]
arquivos: ["**/*.uproject", "**/*.uplugin", "**/Source/**"]
---
Unreal lidera em receita e AAA, e o sistema de replicação é o benchmark para
jogo competitivo rápido.

- `UObject` não é gerenciado por `new`/`delete`. Ponteiro cru para `UObject` sem
  `UPROPERTY()` é coletado pelo GC embaixo de você.
- Replicação é declarada, não improvisada: `GetLifetimeReplicatedProps`,
  `DOREPLIFETIME`, e RPC com o `Server`/`Client`/`NetMulticast` certo.
- Blueprint para composição e ajuste de designer; C++ para sistema e para tudo
  que roda em loop quente. Lógica de rede em Blueprint puro não escala.

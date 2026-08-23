---
id: game-engine-unity-csharp
papeis: [implementador, reparador, avaliador]
arquivos: ["**/*.csproj", "**/Assets/**", "**/ProjectSettings/**"]
deps: ["com.unity.netcode.gameobjects"]
---
Unity segue dominante em mobile (~48% de share, ~70% dos top-grossing) e tem o
toolchain de profiling mais maduro para mobile — é o default recomendado para
jogo mobile.

- `Update()` roda todo frame em toda instância. Nada de busca, alocação ou
  `GetComponent` ali. Cacheie no `Awake`.
- Pooling para tudo que nasce e morre em loop (projétil, partícula, inimigo).
  `Instantiate`/`Destroy` em runtime é a fonte nº 1 de GC spike.
- `ScriptableObject` para dado compartilhado e configuração; `MonoBehaviour`
  só para comportamento preso a cena.
- Corrotina que sobrevive à destruição do objeto vaza. Prefira `async` com
  token de cancelamento amarrado ao ciclo de vida.

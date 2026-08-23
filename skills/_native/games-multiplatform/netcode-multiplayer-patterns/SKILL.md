---
id: netcode-multiplayer-patterns
papeis: [planejador, implementador, avaliador]
arquivos: ["**/*.uproject", "**/project.godot", "**/*.csproj", "**/Assets/**", "**/netcode/**", "**/Multiplayer/**"]
---
**Decisão de engine vem antes do código, e uma escolha errada aqui não se
conserta refatorando.**

- **Godot não tem client-side prediction nem rollback nativo, e não tem lobby
  ou matchmaking embutido** (estado de 2026). Isso é limitação documentada, não
  boato. Escolher Godot para netcode competitivo sem saber disso é decisão de
  arquitetura errada logo na largada — exige solução externa, e o custo dela
  entra no plano, não depois.
- **Unity**: Netcode for GameObjects / for Entities amadureceu no Unity 6. É a
  primeira opção dentro de Unity.
- **Unreal**: o sistema de replicação é o benchmark para jogo competitivo
  rápido. Se o requisito é esse e a equipe aceita C++, é a escolha de menor
  risco.

Independente de engine:

- Servidor é autoritativo. Cliente prevê, servidor decide, cliente reconcilia.
- Nunca confie em posição, dano ou cooldown vindos do cliente.
- Tolerância a lag é requisito de design, não ajuste final: defina o orçamento
  de latência antes de desenhar a mecânica.

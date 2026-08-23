---
id: game-engine-godot-gdscript
papeis: [implementador, reparador, avaliador]
arquivos: ["**/project.godot", "**/*.gd", "**/*.tscn"]
---
- Sinal em vez de referência direta. Nó que conhece o pai pelo caminho
  (`get_node("../../Player")`) quebra na primeira reorganização de cena.
- Cena é a unidade de reuso. Se dois lugares precisam do mesmo comportamento,
  vira cena instanciável, não código copiado.
- `_process` versus `_physics_process`: o primeiro é frame, o segundo é passo
  fixo. Movimento e colisão vão no segundo, sempre.
- Ver `netcode-multiplayer-patterns` antes de assumir Godot para multiplayer
  competitivo — a limitação de prediction/rollback é real.

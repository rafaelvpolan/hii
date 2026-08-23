---
id: realtime-performance-profiling
papeis: [implementador, avaliador]
arquivos: ["**/*.uproject", "**/project.godot", "**/*.csproj", "**/Assets/**"]
---
- Orçamento de frame é número, não sensação: 16,6ms a 60fps, 8,3ms a 120fps.
  Declare o alvo antes de otimizar qualquer coisa.
- Meça na plataforma mais fraca do alvo, não no desktop de quem desenvolve.
- GC pressure mata frame em jogo antes de CPU: alocação por frame é o primeiro
  lugar a olhar, não o último.
- Otimização sem medição antes e depois não é otimização, é palpite com diff.

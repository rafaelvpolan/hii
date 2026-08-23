---
id: cross-platform-build
papeis: [empacotador, planejador]
arquivos: ["**/*.uproject", "**/project.godot", "**/*.csproj", "**/fastlane/**", "**/Dockerfile"]
---
- Requisito de certificação de loja entra no plano no início, não na véspera:
  Steam, App Store, Play e console têm exigência própria de conteúdo, idade,
  privacidade e tamanho.
- Matriz de build é declarada e roda na CI. Build que só funciona na máquina de
  alguém não existe.
- Assinatura e credencial de loja ficam fora do repositório, sempre.
- Cada plataforma tem seu orçamento de tamanho e de memória. O menor manda.

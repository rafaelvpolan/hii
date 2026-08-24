---
id: mobile-cross-platform
papeis: [planejador, implementador, avaliador]
arquivos: ["**/pubspec.yaml", "**/*.dart", "**/metro.config.*", "**/app.json", "**/react-native.config.*", "**/*.podspec"]
deps: ["react-native", "expo", "flutter", "@react-navigation/native", "react-native-reanimated"]
---
**A escolha entre nativo e multiplataforma é de arquitetura, e o critério é o
quanto o produto encosta em API do sistema** — não a preferência da equipe.

- **Flutter** desenha a própria UI. Ganha consistência entre plataformas e perde
  aparência nativa por padrão; integração com API nova do sistema depende de
  canal de plataforma escrito na mão.
- **React Native** usa componentes nativos. A Nova Arquitetura (Fabric e
  TurboModules) é o padrão desde a 0.76 e removeu a ponte assíncrona que era a
  origem histórica de travamento de lista e de animação.
- **Nativo** continua sendo a escolha de menor risco quando o produto vive de
  câmera, sensor, widget de sistema ou recurso que chega primeiro no SDK.

O custo que costuma ficar de fora do plano: **toda funcionalidade que precisa de
código nativo é escrita três vezes** — uma em Dart ou JS, uma em Kotlin, uma em
Swift. Duas plataformas com uma base compartilhada não é a mesma coisa que uma
plataforma.

## Desempenho

- Lista longa usa o componente virtualizado da plataforma. Renderizar mil itens
  e confiar no `clip` trava em aparelho de entrada.
- Animação roda no thread de UI nativo (Reanimated no RN, `AnimationController`
  no Flutter). Animar por estado de JS a 60 quadros compete com a lógica.
- Imagem entra redimensionada para o tamanho de exibição. Bitmap de câmera em
  miniatura é a causa mais comum de falta de memória em aparelho antigo.

## O aparelho do teste não é o do usuário

Emulador em máquina de desenvolvimento esconde jank, consumo de bateria e
limite de memória. Pelo menos um aparelho físico de entrada, com rede lenta
simulada, antes de dar a tela por pronta.

## Ponte nativa

- Chamada entre JS e nativo tem custo por chamada: agrupe em vez de chamar em
  laço.
- Dependência que traz código nativo prende a versão do SDK e aparece no tempo
  de build e na revisão da loja. Avalie o custo de manutenção antes de instalar.

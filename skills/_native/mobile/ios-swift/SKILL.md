---
id: ios-swift
papeis: [implementador, reparador, avaliador]
arquivos: ["**/*.swift", "**/*.xcodeproj/**", "**/*.xcworkspace/**", "**/Info.plist", "**/Package.swift", "**/*.entitlements"]
deps: ["swift-composable-architecture", "Alamofire", "swift-collections"]
---
**SwiftUI é o padrão para tela nova; UIKit continua onde SwiftUI ainda não
alcança** (algumas telas de câmera, texto rico e listas muito grandes). Misturar
os dois é normal e suportado — o que não é normal é reescrever tela estável só
para mudar de framework.

## Concorrência estrita, e o compilador cobra

Swift 6 liga verificação de concorrência por padrão. O que antes era corrida
detectada em produção agora é erro de compilação.

- UI é `@MainActor`. Marcar o tipo inteiro é mais simples e mais seguro que
  espalhar `DispatchQueue.main.async`.
- Tipo cruzando fronteira de ator precisa ser `Sendable`. Classe mutável
  compartilhada não é, e o compilador aponta — a saída é `actor` ou valor
  imutável, não silenciar o aviso.
- `Task` herda contexto e prioridade; `Task.detached` não herda e raramente é o
  que se quer.

## Estado em SwiftUI

- `@State` para estado local da view. `@Observable` (macro, iOS 17+) substitui
  `ObservableObject` com menos cerimônia e recomposição mais precisa.
- View é função do estado. Guardar cópia derivada em `@State` e sincronizar na
  mão cria as duas fontes de verdade que o framework existe para evitar.
- `id` estável em `ForEach`, mesmo motivo do Android: sem isso a view é recriada
  e perde estado.

## Memória

- `ARC` não resolve ciclo: closure que captura `self` dentro de propriedade de
  `self` vaza. `[weak self]` em closure de escape que sobrevive à view.
- Fechamento retido em `Combine` ou `NotificationCenter` sem cancelamento mantém
  a tela viva depois de fechada.

## Antes de submeter

- Toda chave de privacidade usada precisa da descrição no `Info.plist`, e o
  texto é lido pela revisão da loja: descrição genérica é motivo de recusa.
- Manifesto de privacidade e assinatura de SDK de terceiro são exigidos pela
  App Store desde 2024 — dependência sem isso barra a submissão inteira.

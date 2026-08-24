---
id: android-kotlin
papeis: [implementador, reparador, avaliador]
arquivos: ["**/*.kt", "**/*.kts", "**/AndroidManifest.xml", "**/build.gradle*", "**/res/**", "**/app/src/**"]
deps: ["androidx.compose.ui", "androidx.lifecycle", "org.jetbrains.kotlinx:kotlinx-coroutines-android", "com.google.dagger:hilt-android"]
---
**Jetpack Compose é o caminho padrão de UI no Android** (posição oficial do
Google desde 2021, e onde as APIs novas chegam primeiro). View system continua
suportado; projeto novo que escolhe XML assume dívida por decisão, não por
inércia.

## Estado e recomposição

- Estado sobe, evento desce: composable recebe estado e emite evento, quem
  guarda é o `ViewModel`. Composable que lê repositório direto não se testa e
  não se reaproveita.
- `remember` guarda entre recomposições; `rememberSaveable` sobrevive a morte de
  processo e mudança de configuração. Trocar um pelo outro é a origem comum de
  "o campo esvaziou quando girei a tela".
- Leitura de estado dentro do escopo menor possível: ler no topo da tela
  recompõe a tela inteira a cada mudança.
- Lista precisa de `key` estável. Sem chave, reordenar recria item e perde
  estado interno.

## Corrotina e ciclo de vida

- Trabalho de UI vive em `viewModelScope` ou `lifecycleScope`. `GlobalScope`
  sobrevive à tela e vaza.
- Coletar `Flow` na UI com `repeatOnLifecycle(STARTED)` ou `collectAsStateWithLifecycle`:
  coleta sem consciência de ciclo continua rodando com o app em segundo plano.
- Trabalho de disco ou rede sai da main thread por dispatcher explícito. Bloquear
  a main por mais de alguns segundos é ANR, e ANR é relatado na loja.
- Cancelamento é cooperativo: laço longo checa `isActive`, senão o escopo é
  cancelado e o trabalho continua.

## Ciclo de vida e processo

O sistema mata o processo em segundo plano a qualquer momento. Estado que o
usuário digitou e ainda não foi persistido precisa sobreviver a isso — testar
com "não manter atividades" ligado nas opções de desenvolvedor revela em minutos
o que só apareceria em avaliação de loja.

## Permissão e privacidade

- Permissão é pedida no momento do uso, com contexto, não no primeiro abrir.
- Android 13+ exige permissão de notificação em tempo de execução; supor que
  notificação funciona é erro silencioso.
- Declarar permissão no manifesto que a funcionalidade não usa trava publicação.

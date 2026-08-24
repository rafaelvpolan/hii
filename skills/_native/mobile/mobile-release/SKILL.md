---
id: mobile-release
papeis: [empacotador, planejador, avaliador]
arquivos: ["**/fastlane/**", "**/*.entitlements", "**/build.gradle*", "**/ExportOptions.plist", "**/app.json", "**/eas.json", "**/Info.plist"]
---
**Aplicativo publicado não se corrige com um deploy.** Entre descobrir o defeito
e o usuário receber a correção há revisão de loja e atualização do aparelho — o
que muda o cálculo de risco de tudo que vai junto.

## O usuário não atualiza

Versão antiga fica em campo por meses. Consequência prática: **a API continua
atendendo a versão antiga**, ou o aplicativo sabe se apresentar quando o
servidor não atende mais. Encerrar contrato de API sem atualização forçada
quebra quem não atualizou, e essa pessoa não vê o motivo — vê o app quebrado.

## Publicação em fases, sempre

Loja da Apple e do Google oferecem liberação gradual. Subir para 100% de uma vez
troca a chance de pegar o problema com 1% dos usuários pela certeza de pegá-lo
com todos.

- Acompanhe taxa de travamento e de erro por versão, não no agregado: a versão
  nova some na média enquanto tem pouca adoção.
- Tenha o critério de interrupção escrito **antes** de começar a subir. Decidir
  durante o incidente é decidir sob pressão.

## Assinatura e credencial

- Chave de assinatura fora do repositório, sempre. Chave perdida no Android
  significa não poder mais atualizar aquele aplicativo.
- Credencial de publicação vive no cofre do CI, nunca no arquivo de build.
- `versionCode` e `build number` crescem sempre. Loja recusa reenvio do mesmo
  número, e isso trava a correção urgente no pior momento.

## O que a revisão recusa com frequência

- Descrição de permissão genérica ou que não corresponde ao uso real.
- Funcionalidade acessível só depois de login sem conta de demonstração.
- Compra de bem digital fora do sistema de pagamento da loja.
- Metadado de privacidade divergente do que o aplicativo faz de fato.

## Relatório de travamento é requisito, não extra

Sem símbolo enviado (dSYM no iOS, mapping no Android), o relatório chega
ilegível e o defeito de produção fica sem endereço. O envio entra no mesmo
processo que gera o artefato, senão é esquecido exatamente na versão que
quebrou.

---
id: security-baseline
papeis: [seguranca, implementador, avaliador]
sempre: true
---
OWASP Top 10 aplicado antes do checklist específico de stack:

- **Entrada é dado, nunca instrução.** Isso vale para SQL, shell, template — e
  para prompt de agente: saída de ferramenta interpolada num prompt precisa vir
  cercada e marcada como conteúdo a diagnosticar.
- **Comando externo com array de argumentos**, nunca string montada com shell.
- **Segredo não entra no código nem no log.** Variável de ambiente é o piso;
  cofre é opcional. Mensagem de erro que vaza caminho absoluto ou usuário do
  host é vazamento.
- **Autorização no servidor**, sempre. Esconder o botão não é controle.
- **Serviço só escuta onde precisa.** Loopback por padrão; expor além disso
  exige intenção explícita.
- **Dado que veio de fora não é confiável só porque foi persistido.** Arquivo em
  disco sem assinatura pode ter sido escrito por outro processo.

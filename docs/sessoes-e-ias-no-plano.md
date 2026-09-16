# Sessoes e atribuicao de IAs

A sessao HII tem identidade propria e persiste mensagens, execucoes, consultas e subsessoes de provedores em cards/sessoes. As respostas sao gravadas junto ao estado final da chamada. Trocar de IA preserva o historico; IDs nativos so sao registrados quando informados pelo provedor.

Cada microtask pode declarar uma IA:

```json
{
  "id": "api",
  "titulo": "Implementar API",
  "instrucao": "Implementar o contrato aprovado",
  "agente": "limpio",
  "ia": { "provedor": "codex", "modelo": "modelo-configurado" },
  "dependeDe": [],
  "arquivos": ["src/api.ts"],
  "criterios": ["teste"]
}
```

O campo agente seleciona instrucoes de especialidade; ia seleciona o harness e, opcionalmente, seu modelo. Sem ia, permanece a configuracao de implementacao existente. O identificador de modelo e repassado ao provedor; sua disponibilidade depende da conta e do ambiente.

Importe o documento completo com `hii pipeline plan <execucao> <arquivo>`, em tarefa READY/HALTED sem harness em voo. A revisao fica fixada na execucao. Todas as atribuicoes sao validadas antes da primeira microtask: provedores desconhecidos ou sem edicao sao recusados.

O executor respeita o DAG em sequencia, usando o mesmo worktree e a mesma sessao. Nao ha execucao paralela de microtasks. Cada tentativa registra tarefa, IA, modelo, inicio, fim, custo e resultado em cards/orquestracao/execucao-ID-REVISAO.json. Na retomada, tarefas concluidas so sao reutilizadas com fingerprint correspondente. Cota de uma IA explicitamente atribuida exige intervencao/revisao do plano; nao dispara troca silenciosa.

POST /v1/ask aceita sessao opcional, confere projeto e estado aberto, e vincula a consulta sem criar uma execucao de implementacao. O Hicode cria ou reutiliza essa sessao inclusive no modo pergunta. A mesma chave de idempotencia nao duplica a pergunta. Uma consulta sem resultado confirmado apos interrupcao permanece incerta e nao e repetida automaticamente.

Validacao usa harnesses simulados atraves de runProvider, repositorios temporarios e um segundo processo lendo a sessao. Nao comprova autenticacao, cota ou disponibilidade de provedores externos e nao inicia o daemon.

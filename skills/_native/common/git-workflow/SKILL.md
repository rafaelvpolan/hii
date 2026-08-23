---
id: git-workflow
papeis: [implementador, empacotador]
sempre: true
---
- Um commit conta uma mudança inteira e nada além dela. Rename não anda junto
  com feature; refactor não anda junto com correção de bug.
- A mensagem diz o **porquê** e o que quebraria sem ela. O diff já diz o quê.
- Formato Conventional Commits: `tipo(escopo): resumo em minúscula`.
- Nunca `--force` numa branch compartilhada. `--force-with-lease` ancorado no
  último push conhecido, e só na própria branch do card.
- Merge é do humano. Nenhum agente merge nada.

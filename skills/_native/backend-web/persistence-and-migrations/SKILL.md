---
id: persistence-and-migrations
papeis: [implementador, planejador, avaliador]
arquivos: ["**/migrations/**", "**/migrate/**", "**/schema.prisma", "**/*.sql", "**/models/**", "**/entities/**", "**/repositories/**"]
deps: ["prisma", "typeorm", "drizzle-orm", "sequelize", "knex", "mongoose", "pg", "mysql2"]
---
**Migração roda em banco com dados e com tráfego.** O que funciona no banco
vazio do teste é metade do problema.

## Migração é expansão antes de contração

Renomear coluna em uma migração derruba a versão da aplicação que ainda está no
ar durante o deploy. A sequência que não derruba tem três passos, e cada um
entra num deploy separado:

1. **Expande** — adiciona a coluna nova, aceita nulo, e a aplicação passa a
   escrever nas duas.
2. **Migra** — preenche a nova a partir da antiga, em lotes, fora do caminho da
   requisição.
3. **Contrai** — a aplicação para de ler a antiga, e só então a coluna sai.

A mesma regra vale para trocar tipo, dividir tabela e mudar chave.

## O que trava tabela grande

- `ALTER TABLE` que reescreve a tabela bloqueia escrita pelo tempo da reescrita.
  Em Postgres, adicionar coluna com `DEFAULT` constante é barato desde a 11;
  adicionar `NOT NULL` sem default ainda exige varredura.
- Índice em tabela grande é criado com `CONCURRENTLY` (Postgres) ou equivalente
  — e `CONCURRENTLY` não roda dentro de transação, o que muda como a migração é
  escrita.
- Backfill em lote, com pausa entre lotes. Um `UPDATE` sem `WHERE` limitado
  segura o vacuum e infla o WAL.

## Migração é reversível ou é declarada irreversível

Se não há caminho de volta — apagar coluna, por exemplo —, isso é dito no
próprio arquivo. Migração sem `down` e sem aviso vira descoberta durante o
incidente.

## Consulta

- **N+1 é o defeito mais comum e o mais fácil de medir**: conte as consultas no
  teste, não confie no relatório visual. Um teste que fixa o número de consultas
  de um endpoint pega a regressão no dia em que ela entra.
- Índice serve a uma consulta real. Índice "por precaução" custa escrita e
  espaço e não paga.
- `SELECT *` em tabela larga carrega colunas que ninguém lê e impede varredura
  só de índice.
- Paginação por cursor sobre coluna indexada e estável. `OFFSET` grande faz o
  banco percorrer e descartar tudo que veio antes.

## Transação

- Transação é do tamanho da unidade de consistência, nunca do tamanho do
  handler. Chamada de rede dentro de transação aberta segura conexão do pool
  pelo tempo do serviço mais lento.
- Escrita concorrente na mesma linha precisa de decisão explícita: bloqueio
  otimista com versão, ou pessimista com `SELECT ... FOR UPDATE`. Não decidir é
  escolher "o último que escrever ganha", em silêncio.

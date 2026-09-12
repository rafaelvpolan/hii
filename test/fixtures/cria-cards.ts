// Fixture da criacao concorrente (test/cordel/criacao-atomica.test.ts): cria N
// cards no HII_CARDS_DIR herdado e imprime um id por linha — o teste cruza os
// ids de dois processos simultaneos para provar que nao ha colisao nem sobrescrita.
export {}

const quantos = Number(process.argv[2] || '10')
const { createCard } = await import('../../motor/cordel/store.ts')
for (let i = 0; i < quantos; i++) {
  const id = createCard({ title: `carga ${process.pid} ${i}`, status: 'READY', repo: 'org/repo' }, '## Objetivo\ncarga\n')
  process.stdout.write(`${id}\n`)
}

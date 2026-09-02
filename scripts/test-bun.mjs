// Roda a suite sob `bun test` com UM PROCESSO POR ARQUIVO, em paralelo.
//
// Por que um processo por arquivo: `node --test` da isolamento por arquivo de graca —
// cada arquivo roda num processo proprio. `bun test` roda os 248 arquivos num processo
// so, e a suite depende desse isolamento em varios pontos: 129 arquivos ESCREVEM
// `process.env` (353 escritas, 113 no topo do modulo), e os testes que sobem servidor
// HTTP, que leem a trava de instancia ou que mexem em PATH pisam uns nos outros.
//
// O sintoma media a ORDEM, nao o codigo: com a suite inteira num processo, o teste
// de socket que rodava tarde falhava com ConnectionRefused mesmo com `listen` bem
// sucedido e porta valida; mudando a ordem dos diretorios, a falha mudava de dono.
// Foi reproduzido em bun 1.3.14 e 1.4.0 — nao e versao.
//
// Por que em PARALELO: o laco era `spawnSync` um por vez, e por isso a trilha bun
// levava 1m22s contra os 32s da trilha node — a diferenca era o laco serial, nao o
// runner. `node --test` paraleliza por padrao; aqui a piscina tem o mesmo tamanho.
//
// Por que dois arquivos ficam FORA da piscina: `tempo-de-pintura` e `tui-sob-carga`
// medem tempo absoluto de parede e ficam vermelhos com a maquina carregada (observado
// com load average 22, verde de novo com 12, mesmo codigo). Paraleliza-los seria
// fabricar a carga que os derruba. Rodam por ultimo, sozinhos, com a piscina vazia.

// Por que o TETO POR TESTE vem daqui e nao do default: `bun test` corta cada teste
// em 5.000 ms se ninguem disser outra coisa, enquanto a trilha node declara
// `--test-timeout=60000` (package.json). Com a piscina cheia, os dois testes que
// SOBEM SUBPROCESSO estouravam os 5 s e a trilha bun ficava vermelha por saturacao,
// nao por defeito — `bun run test` reprovava com 2727 pass / 2 fail, e os mesmos
// dois arquivos passavam sozinhos em 1,2 s e 3,2 s (medido com load average 12,8
// numa maquina de 8 nucleos). Teto que difere 12x entre as trilhas nao e um teto: e
// um verde que depende de quem esta rodando junto. As duas trilhas passam a declarar
// o MESMO numero, e test/cordel/tetos-das-trilhas.test.ts reprova se divergirem.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { cpus } from 'node:os'

const SENSIVEIS_A_CARGA = new Set([
  join('test', 'mirante', 'tempo-de-pintura.test.ts'),
  join('test', 'mirante', 'tui-sob-carga.test.ts'),
])

const LARGURA_DA_PISCINA = Math.max(1, Number(process.env.HICODE_TEST_JOBS || 0) || cpus().length - 1)
const TETO_POR_TESTE_MS = Number(process.env.HICODE_TEST_TIMEOUT_MS || 0) || 60_000

const reprovados = []
let totalPass = 0
let totalFail = 0

function arquivosDeTeste(raiz) {
  return readdirSync(raiz).flatMap((nome) => {
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) return arquivosDeTeste(caminho)
    return nome.endsWith('.test.ts') ? [caminho] : []
  })
}

function rodar(arquivo) {
  return new Promise((pronto) => {
    const filho = spawn('bun', ['test', '--timeout', String(TETO_POR_TESTE_MS), `./${arquivo}`])
    let saida = ''
    filho.stdout.on('data', (pedaco) => { saida += pedaco })
    filho.stderr.on('data', (pedaco) => { saida += pedaco })
    filho.on('close', (status) => pronto({ arquivo, status, saida }))
  })
}

function contabilizar({ arquivo, status, saida }) {
  totalPass += Number(saida.match(/^\s*(\d+) pass$/m)?.[1] ?? 0)
  totalFail += Number(saida.match(/^\s*(\d+) fail$/m)?.[1] ?? 0)
  if (status !== 0) {
    reprovados.push(arquivo)
    process.stdout.write(`\nREPROVOU ${arquivo}\n${saida}\n`)
  } else {
    process.stdout.write('.')
  }
}

async function emPiscina(lista, largura) {
  const fila = [...lista]
  const trabalhador = async () => {
    for (let proximo = fila.shift(); proximo !== undefined; proximo = fila.shift()) {
      contabilizar(await rodar(proximo))
    }
  }
  await Promise.all(Array.from({ length: Math.min(largura, lista.length) }, trabalhador))
}

const arquivos = arquivosDeTeste('test').sort()
if (!arquivos.length) {
  process.stderr.write('nenhum arquivo .test.ts encontrado em test/ — a suite nao pode passar vazia\n')
  process.exit(1)
}

await emPiscina(arquivos.filter(a => !SENSIVEIS_A_CARGA.has(a)), LARGURA_DA_PISCINA)
await emPiscina(arquivos.filter(a => SENSIVEIS_A_CARGA.has(a)), 1)

process.stdout.write(`\n\n${arquivos.length} arquivo(s) · ${totalPass} pass · ${totalFail} fail · piscina de ${LARGURA_DA_PISCINA}\n`)
if (reprovados.length) {
  process.stdout.write(`\nreprovaram (${reprovados.length}):\n${reprovados.map(a => `  ${a}`).join('\n')}\n`)
  process.exit(1)
}

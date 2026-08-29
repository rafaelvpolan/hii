// Roda a suite sob `bun test` com UM PROCESSO POR ARQUIVO.
//
// Por que existe: `node --test` da isolamento por arquivo de graca — cada arquivo
// roda num processo proprio. `bun test` roda os 248 arquivos num processo so, e a
// suite depende desse isolamento em varios pontos: 66 arquivos escrevem
// `process.env` no topo do modulo, e os testes que sobem servidor HTTP, que leem a
// trava de instancia ou que mexem em PATH pisam uns nos outros.
//
// O sintoma media a ORDEM, nao o codigo: com a suite inteira num processo, o teste
// de socket que rodava tarde falhava com ConnectionRefused mesmo com `listen` bem
// sucedido e porta valida; mudando a ordem dos diretorios, a falha mudava de dono.
// Foi reproduzido em bun 1.3.14 e 1.4.0 — nao e versao.
//
// A alternativa seria tornar 248 arquivos hermeticos num processo compartilhado.
// Isolar e mais barato e da a MESMA garantia que a trilha node ja da.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function arquivosDeTeste(raiz) {
  return readdirSync(raiz).flatMap((nome) => {
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) return arquivosDeTeste(caminho)
    return nome.endsWith('.test.ts') ? [caminho] : []
  })
}

const arquivos = arquivosDeTeste('test').sort()
if (!arquivos.length) {
  process.stderr.write('nenhum arquivo .test.ts encontrado em test/ — a suite nao pode passar vazia\n')
  process.exit(1)
}

const reprovados = []
let totalPass = 0
let totalFail = 0

for (const arquivo of arquivos) {
  const r = spawnSync('bun', ['test', `./${arquivo}`], { encoding: 'utf8' })
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  // O sumario do bun sai em stderr: " N pass" / " N fail".
  totalPass += Number(saida.match(/^\s*(\d+) pass$/m)?.[1] ?? 0)
  const falhas = Number(saida.match(/^\s*(\d+) fail$/m)?.[1] ?? 0)
  totalFail += falhas
  if (r.status !== 0) {
    reprovados.push(arquivo)
    process.stdout.write(`\nREPROVOU ${arquivo}\n${saida}\n`)
  } else {
    process.stdout.write('.')
  }
}

process.stdout.write(`\n\n${arquivos.length} arquivo(s) · ${totalPass} pass · ${totalFail} fail\n`)
if (reprovados.length) {
  process.stdout.write(`\nreprovaram (${reprovados.length}):\n${reprovados.map(a => `  ${a}`).join('\n')}\n`)
  process.exit(1)
}

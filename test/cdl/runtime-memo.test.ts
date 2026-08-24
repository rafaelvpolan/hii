import { test, expect } from 'bun:test'
import { escolhaDeRuntime, esquecerRuntime, runtimeDeScript } from '../../motor/cdl/ali/runtime.ts'
import { ENV_RUNTIME } from '../../motor/cdl/ali/contrato.ts'

// `daemonPid()` -> `eOMotor` -> `runtimeDeScript()` roda a cada quadro da TUI
// (~400ms). Sem memo isso era um spawnSync de `bun --version` por quadro. O que
// nao pode acontecer e o memo mentir quando o operador troca de runtime.

function semEnv<T>(corpo: () => T): T {
  const anterior = process.env[ENV_RUNTIME]
  delete process.env[ENV_RUNTIME]
  esquecerRuntime()
  try {
    return corpo()
  } finally {
    if (anterior === undefined) delete process.env[ENV_RUNTIME]
    else process.env[ENV_RUNTIME] = anterior
    esquecerRuntime()
  }
}

test('a escolha e a MESMA instancia na segunda chamada — prova que nao refez o spawn', () => {
  semEnv(() => {
    const a = escolhaDeRuntime()
    const b = escolhaDeRuntime()
    expect(b, 'objeto novo significa que decidirRuntime rodou de novo, e com ele o spawnSync').toBe(a)
  })
})

test('trocar ENV_RUNTIME muda a resposta na hora — o memo tem a env como chave', () => {
  semEnv(() => {
    escolhaDeRuntime()
    process.env[ENV_RUNTIME] = 'node'
    expect(runtimeDeScript()).toBe('node')
    process.env[ENV_RUNTIME] = 'bun'
    expect(runtimeDeScript(), 'memo que ignora a env devolveria node aqui').toBe('bun')
  })
})

test('runtime invalido continua LANCANDO, e o memo nao guarda o erro como resposta', () => {
  semEnv(() => {
    process.env[ENV_RUNTIME] = 'deno'
    expect(() => runtimeDeScript()).toThrow('deno')
    expect(() => runtimeDeScript(), 'a segunda chamada tem de reprovar igual').toThrow('deno')
  })
})

import { test, expect } from '../apoio/runner.ts'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../motor/cdl/ali/config.ts'
import {
  CONTRATO_MOTOR_PAINEL,
  ENV_AGENTS_DIR,
  ENV_CARDS_DIR,
  ENV_REPOS_FILE,
  ENV_ROOT,
  ENV_RUNNER_LOCK,
  ENV_RUNNER_LOG,
  ENV_RUNNER_PIDFILE,
} from '../../motor/cdl/ali/contrato.ts'

test('as constantes do contrato batem com os nomes de variavel documentados', () => {
  expect(ENV_ROOT).toBe('HICODE_ROOT')
  expect(ENV_CARDS_DIR).toBe('HICODE_CARDS_DIR')
  expect(ENV_REPOS_FILE).toBe('HICODE_REPOS_FILE')
  expect(ENV_AGENTS_DIR).toBe('HICODE_AGENTS_DIR')
  expect(ENV_RUNNER_PIDFILE).toBe('HICODE_RUNNER_PIDFILE')
  expect(ENV_RUNNER_LOCK).toBe('HICODE_RUNNER_LOCK')
  expect(ENV_RUNNER_LOG).toBe('HICODE_RUNNER_LOG')
})

test('nenhuma variavel do contrato se repete', () => {
  const nomes = CONTRATO_MOTOR_PAINEL.map(v => v.nome)
  expect(new Set(nomes).size).toBe(nomes.length)
})

function ladoDesteRepo(): 'motor' | 'painel' {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const nome = typeof pkg === 'object' && pkg !== null ? String((pkg as { name?: unknown }).name ?? '') : ''
  return nome === 'hii' ? 'motor' : 'painel'
}

function moraNesteRepo(variavel: { lado: string }): boolean {
  return variavel.lado === 'ambos' || variavel.lado === ladoDesteRepo()
}

test('todo resolvedor do lado DESTE repo existe de verdade — o do outro lado nao e cobrado aqui', () => {
  for (const variavel of CONTRATO_MOTOR_PAINEL) {
    if (!moraNesteRepo(variavel)) continue
    for (const caminho of variavel.resolvidoPor) {
      expect(existsSync(join(ROOT, caminho)), `${variavel.nome} → ${caminho}`).toBe(true)
    }
  }
})

test('variavel declarada do OUTRO lado nao pode ter o resolvedor morando aqui — a transferencia mente calada', () => {
  for (const variavel of CONTRATO_MOTOR_PAINEL) {
    if (moraNesteRepo(variavel)) continue
    for (const caminho of variavel.resolvidoPor) {
      expect(
        existsSync(join(ROOT, caminho)),
        `${variavel.nome} diz lado="${variavel.lado}" mas ${caminho} existe neste repo — corrija o lado`,
      ).toBe(false)
    }
  }
})

test('toda variavel do contrato declara de que lado ela vive', () => {
  for (const v of CONTRATO_MOTOR_PAINEL) {
    expect(['motor', 'painel', 'ambos'], v.nome).toContain(v.lado)
  }
})

function constanteEsperada(nomeDaVariavel: string): string {
  return `ENV_${nomeDaVariavel.replace(/^HICODE_/, '')}`
}

test('todo arquivo resolvedor referencia de fato a variavel — pelo nome literal ou pela constante do contrato, nao so declara e some', () => {
  for (const variavel of CONTRATO_MOTOR_PAINEL) {
    if (!moraNesteRepo(variavel)) continue
    const constante = constanteEsperada(variavel.nome)
    for (const caminho of variavel.resolvidoPor) {
      const conteudo = readFileSync(join(ROOT, caminho), 'utf8')
      expect(conteudo.includes(variavel.nome) || conteudo.includes(constante), `${variavel.nome} → ${caminho}`).toBe(true)
    }
  }
})

test('HICODE_ROOT nao entra no rol das que precisam do mesmo caminho absoluto nos dois clones — cada clone tem a sua', () => {
  const raiz = CONTRATO_MOTOR_PAINEL.find(v => v.nome === ENV_ROOT)
  expect(raiz?.precisaSerCompartilhadaEntreClones).toBe(false)
})

test('variavel de um lado so NAO pode ser marcada como compartilhada entre clones', () => {
  for (const v of CONTRATO_MOTOR_PAINEL) {
    if (v.lado === 'ambos') continue
    expect(v.precisaSerCompartilhadaEntreClones, `${v.nome} e do lado "${v.lado}" e nao precisa ser compartilhada`).toBe(false)
  }
})

// A divergencia que motivou estes tres testes: o Dockerfile definia
// HICODE_HEALTH_HOST e o codigo lia HICODE_HEALTH_BIND. Nenhum dos dois nomes era
// escrito e lido pelo mesmo lado, e nenhum estava no contrato acima — entao
// nenhuma guarda podia ver. O container fazia EXPOSE 8080 com o servidor ligado em
// 127.0.0.1: /health inalcancavel de fora, e o HEALTHCHECK sondando loopback
// ficava verde por cima da falha.
function envsDoDockerfile(): string[] {
  const texto = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  return [...texto.matchAll(/\b(HICODE_[A-Z0-9_]+)\s*=/g)].map(m => m[1] ?? '').filter(Boolean)
}

test('a varredura do Dockerfile enxerga variaveis — senao o invariante abaixo passaria vazio', () => {
  expect(envsDoDockerfile().length, 'regex quebrou: nenhuma HICODE_* encontrada no Dockerfile').toBeGreaterThan(5)
})

test('toda HICODE_* definida no Dockerfile esta no contrato — nome que so o Dockerfile conhece nao chega no codigo', () => {
  const doContrato = new Set(CONTRATO_MOTOR_PAINEL.map(v => v.nome))
  const orfas = [...new Set(envsDoDockerfile())].filter(n => !doContrato.has(n))
  expect(orfas, 'o Dockerfile define estas e o contrato nao as conhece: o codigo pode estar lendo outro nome').toEqual([])
})

test('o /health do container liga onde o EXPOSE promete — bind de loopback com porta exposta e porta fechada', () => {
  const texto = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
  const porta = texto.match(/^EXPOSE\s+(\d+)/m)?.[1]
  expect(porta, 'sem EXPOSE nao ha promessa a conferir').toBeTruthy()
  expect(texto, `EXPOSE ${porta} exige HICODE_HEALTH_PORT=${porta}`).toContain(`HICODE_HEALTH_PORT=${porta}`)
  const bind = texto.match(/HICODE_HEALTH_BIND=(\S+)/)?.[1]
  expect(bind, 'porta exposta com bind em loopback = ECONNREFUSED para o consumidor real, com HEALTHCHECK interno verde').toBe('0.0.0.0')
})

import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { semearUsoCodex } from './e2e/uso-fixture.ts'
import { planoDoCodex } from '../../motor/euclides/tesouro/planos.ts'
import { janelasDoProvedor } from '../../motor/euclides/tesouro/janelas.ts'
import { provedoresDisponiveis } from '../../motor/tomada/disponibilidade.ts'
import { aplicar } from '../../motor/tomada/escolha-de-ia.ts'
import { estadoDaIa, definirModelo } from '../../motor/mirante/escolher-ia.ts'
import { lerConfig } from '../../motor/cordel/alicerce/snapshot.ts'
import { renderConfig } from '../../motor/mirante/render/config/index.ts'

test('fixture real de uso atualiza leitores e comandos apos cache: conhecido, esgotado, expirado e desconhecido', async () => {
  const base = mkdtempSync(join(tmpdir(), 'hii-uso-fixture-'))
  const anterior = { ...process.env }
  for (const pasta of ['bin', 'cards', 'codex']) mkdirSync(join(base, pasta))
  Object.assign(process.env, {
    PATH: join(base, 'bin'), CODEX_HOME: join(base, 'codex'), HII_CARDS_DIR: join(base, 'cards'),
    HII_IA_FILE: join(base, 'ia.json'), HII_MODELOS_FILE: join(base, 'modelos.json'), HII_REPOS_FILE: join(base, 'repos.json'),
    HII_CLAUDE_CONFIG: join(base, 'claude.json'), HII_KIMI_CONFIG: join(base, 'kimi.toml'), HII_JANELAS_CODEX: '5h,7d',
  })
  writeFileSync(join(base, 'bin/codex'), '#!/bin/sh\nexit 91\n', { mode: 0o755 })
  writeFileSync(join(base, 'modelos.json'), JSON.stringify({ codex: ['modelo-teste'] }))
  writeFileSync(join(base, 'repos.json'), '[]')
  aplicar({ papeis: ['implement'], provider: 'codex', model: 'modelo-teste' })
  const aguardar = async (pronto: () => boolean) => {
    const prazo = performance.now() + 6000
    while (!pronto() && performance.now() < prazo) await new Promise(resolve => setTimeout(resolve, 400))
    expect(pronto()).toBe(true)
  }
  const textoConfig = () => renderConfig(lerConfig('', 'codex'), { color: false, largura: 80, altura: 24 }).join('\n')
  try {
    semearUsoCodex(base, 'conhecido')
    await aguardar(() => planoDoCodex().contexto?.usadoTokens === 25840)
    expect(planoDoCodex().contexto?.percentual).toBe(10)
    expect(janelasDoProvedor('codex').every(j => j.limiteConfiavel && j.restamMs > 0)).toBe(true)
    expect(estadoDaIa().find(l => l.includes('codex'))).toContain('[ok]')
    expect(definirModelo([]).mensagem).toContain('[ok]')
    expect(textoConfig()).toContain('25.840/258.400 tok')
    expect(textoConfig()).toContain('42%')
    expect(textoConfig()).toContain('reseta')

    semearUsoCodex(base, 'esgotado')
    await aguardar(() => provedoresDisponiveis().find(p => p.nome === 'codex')?.situacao === 'cota-esgotada')
    expect(estadoDaIa().find(l => l.includes('codex'))).toContain('[cota]')
    expect(definirModelo([]).mensagem).toContain('[cota]')
    expect(textoConfig()).toContain('cota estourada')
    expect(textoConfig()).toContain('100%')

    semearUsoCodex(base, 'expirado')
    await aguardar(() => janelasDoProvedor('codex').every(j => !j.limiteConfiavel && j.restamMs === 0))
    expect(estadoDaIa().find(l => l.includes('codex'))).toContain('[ok]')
    expect(definirModelo([]).mensagem).toContain('[ok]')
    expect(textoConfig()).toContain('VELHO')
    expect(textoConfig()).toContain('leitura mais velha')
    expect(textoConfig()).toContain('que a janela')

    semearUsoCodex(base, 'desconhecido')
    await aguardar(() => planoDoCodex().leituraDePlano === false)
    expect(planoDoCodex().contexto).toBeUndefined()
    expect(janelasDoProvedor('codex').every(j => j.percentualDoLimite === null)).toBe(true)
    expect(estadoDaIa().find(l => l.includes('codex'))).toContain('[ok]')
    expect(definirModelo([]).mensagem).toContain('[ok]')
    expect(textoConfig()).toContain('limite nao reportado')
    expect(textoConfig()).toContain('nao reportado pelo historico local')
  } finally { process.env = anterior; rmSync(base, { recursive: true, force: true }) }
}, 15000)

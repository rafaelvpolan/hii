import { readFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, test } from '../apoio/runner.ts'
import { classifyFailure } from '../../motor/cic/rpr/classe-de-falha.ts'
import { comandosDaIaAtiva } from '../../motor/tmd/map/comandos.ts'
import { claudeArgv } from '../../motor/tmd/harness/claude-argv.ts'
import { argv as codexArgv } from '../../motor/tmd/harness/codex.ts'
import { kimiArgv } from '../../motor/tmd/harness/kimi.ts'
import { agentRoles, harnessPorNome, modelFor, providerNames } from '../../motor/tmd/registro.ts'
import {
  AJUDA_CLAUDE, AJUDA_CODEX, AJUDA_CURL, AJUDA_KIMI, MODOS, PAPEIS, PATH_COM_FAKES,
  TEM_CLAUDE, TEM_CODEX, TEM_CURL, TEM_KIMI, comPathEmBranco, fakeBin, pedidoReal, pedidoSimples, restaurarAmbiente,
} from './matriz-provedores-apoio.ts'

afterAll(restaurarAmbiente)

test('o registro nao esta vazio, e o eixo de papeis tambem nao — sem isto a matriz inteira passaria vazia', () => {
  expect(providerNames().length).toBeGreaterThan(0)
  expect(agentRoles().length).toBeGreaterThan(0)
})

test('a varredura de combinacoes harness x papel x modo enxerga o suficiente — senao os for-of abaixo passariam vazios', () => {
  expect(providerNames().length).toBe(4)
  expect(agentRoles().length).toBe(4)
  expect(providerNames().length * agentRoles().length * MODOS.length).toBeGreaterThanOrEqual(32)
})

test('claude: --model so aparece em verify/gate (sonnet), nunca em implement/step, em qualquer modo', () => {
  for (const modo of MODOS) {
    for (const papel of PAPEIS) {
      const a = claudeArgv(pedidoReal('claude', papel, modo, ['/wt']))
      if (papel === 'verify' || papel === 'gate') {
        expect(a, `${papel}/${modo}`).toContain('--model')
        expect(a[a.indexOf('--model') + 1], `${papel}/${modo}`).toBe('sonnet')
      } else {
        expect(a, `${papel}/${modo}`).not.toContain('--model')
      }
    }
  }
})

test('claude: --effort aparece com o esforco escolhido em qualquer papel/modo (acceptsEffort=true), e some sem esforco', () => {
  expect(harnessPorNome('claude').capabilities().acceptsEffort).toBe(true)
  for (const modo of MODOS) {
    for (const papel of PAPEIS) {
      const semEsforco = claudeArgv(pedidoReal('claude', papel, modo, ['/wt']))
      expect(semEsforco, `${papel}/${modo} sem esforco`).not.toContain('--effort')
      const comEsforco = claudeArgv({ ...pedidoReal('claude', papel, modo, ['/wt']), effort: 'xhigh' })
      expect(comEsforco, `${papel}/${modo}`).toContain('--effort')
      expect(comEsforco[comEsforco.indexOf('--effort') + 1], `${papel}/${modo}`).toBe('xhigh')
    }
  }
})

test('claude: --permission-mode so aparece no modo edit, nunca no readonly, para todo papel', () => {
  for (const papel of PAPEIS) {
    const edit = claudeArgv(pedidoReal('claude', papel, 'edit', ['/wt']))
    const somenteLeitura = claudeArgv(pedidoReal('claude', papel, 'readonly', ['/wt']))
    expect(edit, papel).toContain('--permission-mode')
    expect(somenteLeitura, papel).not.toContain('--permission-mode')
  }
})

test('claude: --allowedTools troca de lista por modo, para todo papel (edit libera Edit/Write/Bash; readonly restringe a Read/Glob/Grep)', () => {
  for (const papel of PAPEIS) {
    const edit = claudeArgv(pedidoReal('claude', papel, 'edit', ['/wt']))
    const somenteLeitura = claudeArgv(pedidoReal('claude', papel, 'readonly', ['/wt']))
    const toolsEdit = String(edit[edit.indexOf('--allowedTools') + 1] ?? '').split(',')
    const toolsReadonly = String(somenteLeitura[somenteLeitura.indexOf('--allowedTools') + 1] ?? '').split(',')
    for (const t of ['Edit', 'Write', 'Bash']) expect(toolsEdit, papel).toContain(t)
    for (const t of ['Edit', 'Write', 'Bash']) expect(toolsReadonly, papel).not.toContain(t)
    expect(toolsReadonly, papel).toEqual(['Read', 'Glob', 'Grep'])
  }
})

test('claude: --add-dir se repete uma vez por diretorio, na ordem, para qualquer papel/modo', () => {
  const dirs = ['/wt/base', '/wt/extra', '/wt/mais-um']
  for (const modo of MODOS) {
    for (const papel of PAPEIS) {
      const a = claudeArgv(pedidoReal('claude', papel, modo, dirs))
      expect(a.filter(x => x === '--add-dir'), `${papel}/${modo}`).toHaveLength(3)
      expect(a.slice(a.indexOf('--add-dir')), `${papel}/${modo}`).toEqual(['--add-dir', dirs[0], '--add-dir', dirs[1], '--add-dir', dirs[2]])
    }
  }
})

test('codex: --sandbox reflete o modo (workspace-write no edit, read-only no readonly), independente do papel', () => {
  for (const papel of PAPEIS) {
    const edit = codexArgv(pedidoReal('codex', papel, 'edit', ['/wt']), '/wt')
    const somenteLeitura = codexArgv(pedidoReal('codex', papel, 'readonly', ['/wt']), '/wt')
    expect(edit.slice(edit.indexOf('--sandbox'), edit.indexOf('--sandbox') + 2), papel).toEqual(['--sandbox', 'workspace-write'])
    expect(somenteLeitura.slice(somenteLeitura.indexOf('--sandbox'), somenteLeitura.indexOf('--sandbox') + 2), papel).toEqual(['--sandbox', 'read-only'])
  }
})

test('codex: approval_policy vem do modo resolvido (nunca do papel) e e "never" por padrao; --add-dir pula dirs[0]', () => {
  const dirs = ['/wt/base', '/wt/extra', '/wt/mais-um']
  for (const papel of PAPEIS) {
    const a = codexArgv(pedidoReal('codex', papel, 'edit', dirs), dirs[0] ?? '')
    expect(a, papel).toContain('approval_policy="never"')
    expect(a.filter(x => x === '--add-dir'), papel).toHaveLength(2)
    expect(a.slice(a.indexOf('--add-dir')), papel).toEqual(['--add-dir', dirs[1], '--add-dir', dirs[2]])
  }
})

test('codex: -m so aparece com modelo, e model_reasoning_effort so aparece com esforco — em qualquer papel/modo (acceptsEffort=true)', () => {
  expect(harnessPorNome('codex').capabilities().acceptsEffort).toBe(true)
  for (const modo of MODOS) {
    for (const papel of PAPEIS) {
      const semNada = codexArgv(pedidoReal('codex', papel, modo, ['/wt']), '/wt')
      expect(semNada, `${papel}/${modo}`).not.toContain('-m')
      expect(semNada.join(' '), `${papel}/${modo}`).not.toContain('model_reasoning_effort')
      const comAmbos = codexArgv({ ...pedidoReal('codex', papel, modo, ['/wt']), model: 'gpt-5-codex', effort: 'high' }, '/wt')
      expect(comAmbos, `${papel}/${modo}`).toContain('-m')
      expect(comAmbos[comAmbos.indexOf('-m') + 1], `${papel}/${modo}`).toBe('gpt-5-codex')
      expect(comAmbos, `${papel}/${modo}`).toContain('model_reasoning_effort="high"')
    }
  }
})

test('kimi: o argv e IDENTICO entre papel e entre modo, exceto -m — restrictsTools/isolatesReadonly=false na pratica', () => {
  const capacidades = harnessPorNome('kimi').capabilities()
  expect(capacidades.restrictsTools).toBe(false)
  expect(capacidades.isolatesReadonly).toBe(false)
  const referencia = kimiArgv(pedidoReal('kimi', 'implement', 'edit', ['/wt']))
  for (const modo of MODOS) {
    for (const papel of PAPEIS) {
      const a = kimiArgv(pedidoReal('kimi', papel, modo, ['/wt']))
      expect(a, `${papel}/${modo}`).toEqual(referencia)
    }
  }
  const comModelo = kimiArgv({ ...pedidoReal('kimi', 'implement', 'edit', ['/wt']), model: 'kimi-k2' })
  expect(comModelo).not.toEqual(referencia)
  expect(comModelo[comModelo.indexOf('-m') + 1]).toBe('kimi-k2')
})

test('ollama: a chamada ao curl (args e corpo) e IDENTICA entre papel e modo — isolatesReadonly nao e imposto por diferenca de argv', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hii-matriz-ollama-argv-'))
  const localBin = join(dir, 'bin')
  mkdirSync(localBin, { recursive: true })
  const argvFile = join(dir, 'argv.txt')
  writeFileSync(join(localBin, 'curl'), `#!/usr/bin/env bash\n: > "${argvFile}"\nfor a in "$@"; do printf '%s\\0' "$a" >> "${argvFile}"; done\necho '{"response":"ok","prompt_eval_count":1,"eval_count":1}'\n`)
  chmodSync(join(localBin, 'curl'), 0o755)
  process.env.PATH = `${localBin}:${PATH_COM_FAKES}`
  try {
    const capturados = new Set<string>()
    for (const modo of MODOS) {
      for (const papel of PAPEIS) {
        await harnessPorNome('ollama').run(pedidoReal('ollama', papel, modo, [dir]))
        capturados.add(readFileSync(argvFile, 'utf8'))
      }
    }
    expect(capturados.size, 'toda combinacao de papel/modo produziu o MESMO argv/corpo de curl').toBe(1)
  } finally {
    process.env.PATH = PATH_COM_FAKES
    rmSync(dir, { recursive: true, force: true })
  }
})

test('so o claude decide modelo por papel; codex/kimi/ollama devolvem o mesmo (ou nenhum) modelo em qualquer papel', () => {
  const variacaoPorHarness = new Map<string, Set<string>>()
  for (const nome of providerNames()) {
    variacaoPorHarness.set(nome, new Set(PAPEIS.map(papel => String(modelFor(papel, nome)))))
  }
  expect(variacaoPorHarness.get('claude')?.size ?? 0, 'claude varia por papel: implement/step sem modelo, verify/gate com sonnet').toBeGreaterThan(1)
  for (const nome of ['codex', 'kimi', 'ollama']) {
    expect(variacaoPorHarness.get(nome)?.size ?? 0, nome).toBe(1)
  }
})

test('claude: --help do binario real lista todas as flags que claudeArgv monta', () => {
  if (!TEM_CLAUDE) return
  for (const flag of ['--add-dir', '--agents', '--allowedTools', '--effort', '--model', '--output-format', '--permission-mode', '-p, --print']) {
    expect(AJUDA_CLAUDE, flag).toContain(flag)
  }
})

test('kimi: --help do binario real confirma as flags que kimiArgv usa, e nao lista as que o motor evita de proposito', () => {
  if (!TEM_KIMI) return
  for (const flag of ['-p, --prompt', '--output-format', '-m, --model', '--add-dir']) {
    expect(AJUDA_KIMI, flag).toContain(flag)
  }
  for (const flag of ['--allowedTools', '--allowed-tools', '--effort', '--permission-mode', '--sandbox', '--json']) {
    expect(AJUDA_KIMI, flag).not.toContain(flag)
  }
})

test('codex: --help do "exec" confirmaria exec/-C/--sandbox/-c/--json/-m quando o binario existir neste host', () => {
  if (!TEM_CODEX) return
  for (const flag of ['-C', '--sandbox', '-c', '--json', '-m']) {
    expect(AJUDA_CODEX, flag).toContain(flag)
  }
})

test('ollama roda via curl, nao via um binario proprio: --help all confirma -H/-d/-s/-q/--noproxy, os flags que o harness monta', () => {
  if (!TEM_CURL) return
  for (const flag of ['-H, --header', '-d, --data', '-s, --silent', '-q, --disable', '--noproxy']) {
    expect(AJUDA_CURL, flag).toContain(flag)
  }
})

test('claude: quota (CLAUDE_SINAIS) classificada a partir de texto REAL devolvido pelo CLI, nao de ctx escrito a mao', async () => {
  fakeBin('claude', `#!/usr/bin/env bash\necho '{"total_cost_usd":0.02,"result":"Claude AI usage limit reached. Your limit will reset at 5pm.","is_error":true,"usage":{"input_tokens":3,"output_tokens":1}}'\n`)
  const res = await harnessPorNome('claude').run(pedidoSimples())
  expect(res.ok).toBe(false)
  expect(res.costMeasured).toBe(true)
  const cls = classifyFailure(harnessPorNome('claude'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('quota')
  expect(cls.reason).toBe('limite de uso da assinatura Claude atingido')
})

test('claude: transiente proprio (overloaded_error) nunca tinha teste nenhum via classifyFailure — fechando a lacuna', async () => {
  fakeBin('claude', `#!/usr/bin/env bash\necho '{"total_cost_usd":0.01,"result":"API Error: overloaded_error - server overloaded, try again","is_error":true,"usage":{"input_tokens":3,"output_tokens":1}}'\n`)
  const res = await harnessPorNome('claude').run(pedidoSimples())
  const cls = classifyFailure(harnessPorNome('claude'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('transient')
  expect(cls.reason).toBe('erro transitorio da API Anthropic')
})

test('codex: quota chega via stderr+exit-nao-zero (err.message absorve o stderr) — CODEX_SINAIS.quota alcancavel deste jeito', async () => {
  fakeBin('codex', `#!/usr/bin/env bash\necho 'algo no stdout'\necho 'insufficient_quota: exceeded_quota for this account' >&2\nexit 1\n`)
  const res = await harnessPorNome('codex').run(pedidoSimples())
  expect(res.ok).toBe(false)
  expect(res.detail).toContain('insufficient_quota')
  const cls = classifyFailure(harnessPorNome('codex'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('quota')
  expect(cls.reason).toBe('cota da API OpenAI esgotada')
})

test('codex: transiente proprio (rate_limit_exceeded) so alcancavel via stderr+exit-nao-zero, nao pelo evento JSON de erro', async () => {
  fakeBin('codex', `#!/usr/bin/env bash\necho 'rate_limit_exceeded: slow down' >&2\nexit 1\n`)
  const res = await harnessPorNome('codex').run(pedidoSimples())
  const cls = classifyFailure(harnessPorNome('codex'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('transient')
  expect(cls.reason).toBe('limite de taxa da API OpenAI')
})

test('REGRESSAO codex: agent_message parcial ANTES de type:"error" faz a mensagem do erro (insufficient_quota) nunca chegar em text/detail — classifyFailure cai no generico', async () => {
  fakeBin('codex', `#!/usr/bin/env bash\ncat <<'FIM'\n{"type":"item.completed","item":{"type":"agent_message","text":"iniciando a tarefa"}}\n{"type":"error","message":"insufficient_quota: exceeded_quota for this account"}\nFIM\n`)
  const res = await harnessPorNome('codex').run(pedidoSimples())
  expect(res.ok).toBe(false)
  expect(res.text).toBe('iniciando a tarefa')
  expect(res.text, 'a mensagem do evento de erro nunca chega em text nem em detail').not.toContain('insufficient_quota')
  expect(res.detail).toBe('')
  const cls = classifyFailure(harnessPorNome('codex'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass, 'deveria ser quota; cai em terminal generico porque parse() descarta o campo message do evento de erro quando ja havia texto de agent_message').toBe('terminal')
  expect(cls.reason).toBe('falha nao reconhecida — tratada como terminal (mais barato parar que repetir para sempre)')
})

test('kimi: terminal (KIMI_SINAIS, "not authenticated") classificado a partir de saida real — nenhum teste chamava classifyFailure com o kimi antes', async () => {
  fakeBin('kimi', `#!/usr/bin/env bash\ncat <<'FIM'\n{"error_name":"AuthError","error_message":"not authenticated, please run kimi login","status_code":401}\nFIM\n`)
  const res = await harnessPorNome('kimi').run(pedidoSimples())
  expect(res.ok).toBe(false)
  expect(res.detail).toContain('not authenticated')
  const cls = classifyFailure(harnessPorNome('kimi'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('terminal')
  expect(cls.reason).toBe('kimi sem autenticacao (rode: kimi login)')
})

test('kimi: sinaisDeFalha nao declara quota nem transiente proprios de proposito — um 429 real cai no GENERICO', async () => {
  const sinais = harnessPorNome('kimi').sinaisDeFalha()
  expect(sinais.quota).toEqual([])
  expect(sinais.transient).toEqual([])
  fakeBin('kimi', `#!/usr/bin/env bash\ncat <<'FIM'\n{"error_name":"RateLimitError","error_message":"too many requests","status_code":429}\nFIM\n`)
  const res = await harnessPorNome('kimi').run(pedidoSimples())
  const cls = classifyFailure(harnessPorNome('kimi'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('transient')
  expect(cls.reason).toBe('limite de taxa (429)')
})

test('ollama: terminal (OLLAMA_SINAIS, "model not found") classificado a partir de saida real — so "connection refused" tinha teste antes', async () => {
  fakeBin('curl', `#!/usr/bin/env bash\necho '{"error":"model not found, try pulling it first"}'\n`)
  const res = await harnessPorNome('ollama').run(pedidoSimples())
  expect(res.ok).toBe(false)
  const cls = classifyFailure(harnessPorNome('ollama'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('terminal')
  expect(cls.reason).toBe('modelo ollama nao encontrado localmente')
})

test('ollama: sinaisDeFalha nao declara quota propria de proposito — "monthly limit reached" so classifica via GENERICO', async () => {
  const sinais = harnessPorNome('ollama').sinaisDeFalha()
  expect(sinais.quota).toEqual([])
  fakeBin('curl', `#!/usr/bin/env bash\necho '{"error":"monthly limit reached for this account"}'\n`)
  const res = await harnessPorNome('ollama').run(pedidoSimples())
  const cls = classifyFailure(harnessPorNome('ollama'), { timedOut: res.timedOut, detail: res.detail, text: res.text })
  expect(cls.failureClass).toBe('quota')
  expect(cls.reason).toBe('cota do provedor esgotada')
})

test('ENOENT real (binario ausente de verdade, PATH em branco) vira terminal com o motivo certo, nos quatro harnesses', async () => {
  for (const nome of providerNames()) {
    const res = await comPathEmBranco(() => harnessPorNome(nome).run(pedidoSimples()))
    expect(res.ok, nome).toBe(false)
    // A frase depende do RUNTIME: node diz `spawn ENOENT`, bun diz
    // `Executable not found in $PATH`. Exigir 'ENOENT' amarrava o teste ao node e
    // escondia que o classificador do motor nao reconhecia a forma do bun — que e
    // o runtime real do motor. Aqui basta que o detalhe nomeie a ausencia; quem
    // decide o significado e a assercao de classificacao logo abaixo.
    expect(/enoent|executable not found/i.test(res.detail), `${nome}: detalhe nao nomeia binario ausente — ${res.detail}`).toBe(true)
    const cls = classifyFailure(harnessPorNome(nome), { timedOut: res.timedOut, detail: res.detail, text: res.text })
    expect(cls.failureClass, nome).toBe('terminal')
    expect(cls.reason, nome).toBe('provedor nao instalado (binario nao encontrado)')
  }
})

test('timeout (wrapper generico de qlb/git.ts) vira transient em qualquer harness que passe por ele — so o claude tinha prova disto, e so pelo caminho de stream', async () => {
  fakeBin('claude', '#!/usr/bin/env bash\nexec sleep 30\n')
  fakeBin('codex', '#!/usr/bin/env bash\nexec sleep 30\n')
  fakeBin('kimi', '#!/usr/bin/env bash\nexec sleep 30\n')
  fakeBin('curl', '#!/usr/bin/env bash\nexec sleep 30\n')
  for (const nome of providerNames()) {
    const res = await harnessPorNome(nome).run(pedidoSimples({ timeoutMs: 300 }))
    expect(res.timedOut, nome).toBe(true)
    expect(res.ok, nome).toBe(false)
    const cls = classifyFailure(harnessPorNome(nome), { timedOut: res.timedOut, detail: res.detail, text: res.text })
    expect(cls.failureClass, nome).toBe('transient')
  }
})

test('REGRESSAO cruzada: saida truncada/nao-JSON com exit 0 vira ok:true e texto cru NOS QUATRO harnesses — achado real, nao de um provedor so', async () => {
  fakeBin('claude', "#!/usr/bin/env bash\necho 'lixo-claude-{{{ truncado'\n")
  fakeBin('codex', "#!/usr/bin/env bash\necho 'lixo-codex sem chave nenhuma'\n")
  fakeBin('kimi', "#!/usr/bin/env bash\necho 'lixo-kimi sem chave nenhuma'\n")
  fakeBin('curl', "#!/usr/bin/env bash\necho 'lixo-ollama sem chave nenhuma'\n")
  for (const nome of providerNames()) {
    const res = await harnessPorNome(nome).run(pedidoSimples())
    expect(res.ok, `${nome}: caracterizacao do comportamento atual — isError so muda dentro do parse, o catch de saida ilegivel nunca o marca`).toBe(true)
    expect(res.isError, nome).toBe(false)
  }
})

test('inventario travado: quantos sinais proprios (terminal/quota/transient) cada harness declara — mudar aqui exige revisao deliberada', () => {
  const inventario: Record<string, { terminal: number; quota: number; transient: number }> = {}
  for (const nome of providerNames()) {
    const sinais = harnessPorNome(nome).sinaisDeFalha()
    inventario[nome] = { terminal: sinais.terminal.length, quota: sinais.quota.length, transient: sinais.transient.length }
  }
  expect(inventario).toEqual({
    claude: { terminal: 0, quota: 1, transient: 1 },
    codex: { terminal: 0, quota: 1, transient: 1 },
    ollama: { terminal: 1, quota: 0, transient: 1 },
    kimi: { terminal: 1, quota: 0, transient: 0 },
  })
})

test('ollama fica de fora de FONTES por decisao — mesmo com claude, codex e kimi TODOS povoados ao mesmo tempo, so ollama devolve lista vazia (autoridade: test/tmd/map-comandos.test.ts)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hii-matriz-fontes-home-'))
  const repoDir = mkdtempSync(join(tmpdir(), 'hii-matriz-fontes-repo-'))
  const codexHome = join(home, '.codex-custom')
  const antigos = {
    HICODE_CLAUDE_HOME_DIR: process.env.HICODE_CLAUDE_HOME_DIR,
    HICODE_KIMI_HOME_DIR: process.env.HICODE_KIMI_HOME_DIR,
    CODEX_HOME: process.env.CODEX_HOME,
    HICODE_IMPLEMENT_PROVIDER: process.env.HICODE_IMPLEMENT_PROVIDER,
  }
  process.env.HICODE_CLAUDE_HOME_DIR = join(home, '.claude')
  process.env.HICODE_KIMI_HOME_DIR = join(home, '.kimi-code')
  process.env.CODEX_HOME = codexHome
  try {
    mkdirSync(join(repoDir, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(repoDir, '.claude', 'commands', 'foo.md'), '---\ndescription: "comando do projeto"\n---\ncorpo\n')
    mkdirSync(join(codexHome, 'skills', 'imagegen'), { recursive: true })
    writeFileSync(join(codexHome, 'skills', 'imagegen', 'SKILL.md'), '---\nname: imagegen\ndescription: "gera imagem"\n---\ncorpo\n')
    mkdirSync(join(repoDir, '.kimi-code', 'skills', 'revisa'), { recursive: true })
    writeFileSync(join(repoDir, '.kimi-code', 'skills', 'revisa', 'SKILL.md'), '---\nname: revisa\ndescription: "revisa PR"\n---\ncorpo\n')

    process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
    expect(comandosDaIaAtiva(repoDir).comandos.length, 'claude precisa ter fonte real aqui, senao o contraste com ollama nao prova nada').toBeGreaterThan(0)
    process.env.HICODE_IMPLEMENT_PROVIDER = 'codex'
    expect(comandosDaIaAtiva(repoDir).comandos.length, 'codex idem').toBeGreaterThan(0)
    process.env.HICODE_IMPLEMENT_PROVIDER = 'kimi'
    expect(comandosDaIaAtiva(repoDir).comandos.length, 'kimi idem').toBeGreaterThan(0)
    process.env.HICODE_IMPLEMENT_PROVIDER = 'ollama'
    expect(comandosDaIaAtiva(repoDir).comandos, 'ollama continua vazio mesmo com os outros tres populados ao mesmo tempo').toEqual([])
    expect(harnessPorNome('ollama').exigeCliNoPath, 'ollama nao tem CLI proprio no PATH — nao ha onde procurar comando/skill').toBe(false)
    expect(harnessPorNome('ollama').comandoDeLogin).toEqual([])
  } finally {
    for (const [chave, valor] of Object.entries(antigos)) {
      if (valor === undefined) delete process.env[chave]
      else process.env[chave] = valor
    }
    rmSync(home, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  }
})

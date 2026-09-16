import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A preferencia da pessoa nao escolhe um CLI real no lugar do fake do teste.
const raiz = mkdtempSync(join(tmpdir(), 'hii-test-config-'))
process.env.HII_IA_FILE = join(raiz, 'ia.json')
process.on('exit', () => rmSync(raiz, { recursive: true, force: true }))

import { writeFileSync } from 'node:fs'
import { openapi } from '../motor/api/openapi.ts'

const destino = process.argv[2] || 'docs/conexao-hicode/openapi.json'
writeFileSync(destino, JSON.stringify(openapi, null, 2) + '\n')
console.log(`OpenAPI exportado: ${destino}`)

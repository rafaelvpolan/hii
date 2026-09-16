import { lerSessaoHii, vincularConsulta } from '../euclides/sessoes.ts'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { repoPath, repoRegistered } from '../cordel/store.ts'
import { runProvider, recusaPorLimite } from '../euclides/tesouro/confianca.ts'
import { providerFor, modelFor, effortFor } from '../tomada/registro.ts'
import { writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { iniciar, terminar, recurso, dentro, textoPublico } from '../observabilidade/registro.ts'
import { campos, texto, ErroApi } from './contrato.ts'
import type { Objeto } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'

interface Consulta { versao: 1; id: string; repo: string; sessao?: string; estado: 'running' | 'succeeded' | 'failed' | 'unknown'; atividade: string; resposta: string; custoUsd: number | null; dono: number; inicio: string }
const ativas = new Set<string>()
function arquivo(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ErroApi(400, 'id_invalido', 'ID de consulta invalido')
  return join(cardsDir(), 'consultas', `${id}.json`)
}
export function lerConsulta(id: string): Consulta {
  if (!existsSync(arquivo(id))) throw new ErroApi(404, 'consulta_ausente', 'consulta nao encontrada')
  const c = JSON.parse(readFileSync(arquivo(id), 'utf8')) as Consulta
  if (c.estado === 'running') {
    try { process.kill(c.dono, 0) } catch { c.estado = 'unknown' }
    if (c.dono === process.pid && !ativas.has(id)) c.estado = 'unknown'
  }
  return c
}
export function criarConsulta(b: Objeto, executar: typeof runProvider = runProvider): RespostaApi {
  campos(b, ['repo', 'pergunta', 'sessao'])
  const repo = texto(b, 'repo')
  const sessao = texto(b, 'sessao', false, 128)
  if (sessao) {
    const s = lerSessaoHii(sessao)
    if (!s || s.repo !== repo) throw new ErroApi(403, 'sessao_invalida', 'sessao nao pertence ao projeto')
    if (s.estado !== 'aberta') throw new ErroApi(409, 'sessao_fechada', 'abra outra sessao')
  }
  const pergunta = texto(b, 'pergunta', true, 16000)
  if (!repoRegistered(repo)) throw new ErroApi(404, 'repo_ausente', 'projeto nao registrado')
  if (ativas.size >= 4) throw new ErroApi(429, 'limite_consultas', 'aguarde consultas em andamento')
  const provider = providerFor('verify')
  const req = { prompt: `Responda a pergunta sobre este projeto em modo somente leitura. Nao edite arquivos nem execute operacoes mutaveis.\n\n${pergunta}`, cwd: repoPath(repo), dirs: [repoPath(repo)], mode: 'readonly' as const, useAgents: false, model: modelFor('verify'), effort: effortFor('verify'), timeoutMs: 120000 }
  const recusa = recusaPorLimite(provider, req)
  if (recusa) throw new ErroApi(409, 'readonly_indisponivel', recusa)
  const id = randomUUID()
  const atividade = iniciar({ repo, sessao, execucao: '' }, recurso('ask', 'orchestrator'), { consulta: id, somenteLeitura: true })
  const c: Consulta = { versao: 1, id, repo, ...(sessao ? { sessao } : {}), atividade, estado: 'running', resposta: '', custoUsd: null, dono: process.pid, inicio: new Date().toISOString() }
  mkdirSync(join(cardsDir(), 'consultas'), { recursive: true })
  const destino = arquivo(id)
  // Intencao persistida antes da chamada. Crash deixa unknown; nunca repete IA.
  writeFileAtomic(destino, JSON.stringify(c))
  if (sessao) vincularConsulta(sessao, id, pergunta)
  ativas.add(id)
  setImmediate(() => {
    void dentro(atividade, async () => {
      try {
        const r = await executar(sessao, provider, { ...req, consultaId: id }, 'verify')
        c.estado = r.ok ? 'succeeded' : 'failed'
        c.resposta = textoPublico(r.text || r.detail).slice(-65536)
        c.custoUsd = r.costMeasured ? r.cost : null

        terminar(atividade, r.ok ? 'succeeded' : 'failed')
      } catch {
        c.estado = 'failed'; c.resposta = 'consulta interrompida; nao repetida automaticamente'
        terminar(atividade, 'failed', c.resposta)
      } finally {
        ativas.delete(id)
        try { writeFileAtomic(destino, JSON.stringify(c)) } catch { /* resultado incerto, nao repetir */ }
      }
    })
  })
  return resposta(202, c)
}

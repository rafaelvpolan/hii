export const ENV_ROOT = 'HII_ROOT'
export const ENV_CARDS_DIR = 'HII_CARDS_DIR'
export const ENV_REPOS_FILE = 'HII_REPOS_FILE'
export const ENV_AGENTS_DIR = 'HII_AGENTS_DIR'
export const ENV_RUNNER_PIDFILE = 'HII_RUNNER_PIDFILE'
export const ENV_RUNNER_LOCK = 'HII_RUNNER_LOCK'
export const ENV_RUNNER_LOG = 'HII_RUNNER_LOG'
export const ENV_IA_FILE = 'HII_IA_FILE'
export const ENV_MODELOS_FILE = 'HII_MODELOS_FILE'
export const ENV_CLAUDE_HOME_DIR = 'HII_CLAUDE_HOME_DIR'
export const ENV_KIMI_HOME_DIR = 'HII_KIMI_HOME_DIR'
export const ENV_TOPOLOGIA_FILE = 'HII_TOPOLOGIA_FILE'
export const ENV_REGRAS_FILE = 'HII_REGRAS_FILE'
export const ENV_CRITERIOS_FILE = 'HII_CRITERIOS_FILE'
export const ENV_SKILLS_DIR = 'HII_SKILLS_DIR'
export const ENV_TIER_FILE = 'HII_TIER_FILE'
export const ENV_RUNTIME = 'HII_RUNTIME'
export const ENV_SECRETS_DIR = 'HII_SECRETS_DIR'
export const ENV_ENQUADRAMENTOS_FILE = 'HII_ENQUADRAMENTOS_FILE'
export const ENV_HEALTH_PORT = 'HII_HEALTH_PORT'
// O Dockerfile definia HII_HEALTH_HOST e o codigo lia HII_HEALTH_BIND: nome
// nenhum era escrito e lido pelo mesmo lado, e nenhum dos dois estava neste
// contrato. O container fazia EXPOSE 8080 e o servidor ligava em 127.0.0.1, ou
// seja /health inalcancavel de fora — e o HEALTHCHECK sondava loopback, ficando
// verde por cima da falha. Estar aqui e o que faz o teste de contrato reprovar
// nome que so um lado conhece.
export const ENV_HEALTH_BIND = 'HII_HEALTH_BIND'

export type LadoDoContrato = 'motor' | 'painel' | 'ambos'

export interface VariavelDoContrato {
  readonly nome: string
  readonly precisaSerCompartilhadaEntreClones: boolean
  readonly resolvidoPor: readonly string[]
  readonly lado: LadoDoContrato
}

export const CONTRATO_MOTOR_PAINEL: readonly VariavelDoContrato[] = [
  { nome: ENV_ROOT, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/cordel/alicerce/config.ts'], lado: 'ambos' },
  { nome: ENV_CARDS_DIR, precisaSerCompartilhadaEntreClones: true, resolvidoPor: ['motor/cordel/alicerce/config.ts'], lado: 'ambos' },
  { nome: ENV_REPOS_FILE, precisaSerCompartilhadaEntreClones: true, resolvidoPor: ['motor/cordel/alicerce/config.ts'], lado: 'ambos' },
  { nome: ENV_AGENTS_DIR, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/agentes/registro.ts'], lado: 'motor' },
  { nome: ENV_RUNNER_PIDFILE, precisaSerCompartilhadaEntreClones: true, resolvidoPor: ['motor/oswaldo/mutirao/daemon.ts', 'scripts/runner-daemon.sh'], lado: 'ambos' },
  { nome: ENV_RUNNER_LOCK, precisaSerCompartilhadaEntreClones: true, resolvidoPor: ['motor/oswaldo/mutirao/trava-instancia.ts', 'scripts/runner-daemon.sh'], lado: 'ambos' },
  { nome: ENV_RUNNER_LOG, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['scripts/runner-daemon.sh'], lado: 'motor' },
  { nome: ENV_IA_FILE, precisaSerCompartilhadaEntreClones: true, resolvidoPor: ['motor/tomada/preferencias.ts'], lado: 'ambos' },
  { nome: ENV_MODELOS_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/tomada/catalogo.ts'], lado: 'motor' },
  { nome: ENV_CLAUDE_HOME_DIR, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/tomada/mapa/comandos.ts'], lado: 'motor' },
  { nome: ENV_KIMI_HOME_DIR, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/tomada/mapa/comandos.ts'], lado: 'motor' },
  { nome: ENV_TOPOLOGIA_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/niemeyer/topologia.ts'], lado: 'motor' },
  { nome: ENV_REGRAS_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/cascudo/lei/guarda.ts'], lado: 'motor' },
  { nome: ENV_CRITERIOS_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/ciclo/crivo/criterios.ts'], lado: 'motor' },
  { nome: ENV_SKILLS_DIR, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/cordel/alicerce/config.ts'], lado: 'motor' },
  { nome: ENV_TIER_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/euclides/tesouro/orcamento.ts'], lado: 'motor' },
  { nome: ENV_RUNTIME, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/cordel/alicerce/runtime.ts'], lado: 'motor' },
  { nome: ENV_SECRETS_DIR, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/quilombo/cofre/segredos.ts'], lado: 'motor' },
  { nome: ENV_ENQUADRAMENTOS_FILE, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/ciclo/macunaima/enquadramentos.ts'], lado: 'motor' },
  { nome: ENV_HEALTH_PORT, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/euclides/radar/servidor.ts', 'Dockerfile'], lado: 'motor' },
  { nome: ENV_HEALTH_BIND, precisaSerCompartilhadaEntreClones: false, resolvidoPor: ['motor/euclides/radar/servidor.ts', 'Dockerfile'], lado: 'motor' },
]

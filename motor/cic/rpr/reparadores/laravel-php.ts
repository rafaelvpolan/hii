import type { ReparadorDeBuild } from './tipos'

const MARCAS = [/(^|\/)composer\.json$/, /(^|\/)artisan$/, /\.php$/, /(^|\/)database\/migrations\//]

export const laravelPhp: ReparadorDeBuild = {
  id: 'laravel-php',
  agente: 'rufus',
  detecta: arquivos => arquivos.some(a => MARCAS.some(rx => rx.test(a))),
  instrucao: saida => [
    'O build/analise estatica de um projeto Laravel/PHP falhou. Saida:',
    saida,
    'Corrija SOMENTE o que a saida aponta, sem mudar comportamento. Neste dominio, cheque em ordem:',
    '1. namespace e caminho do arquivo batem com o PSR-4 do composer.json;',
    '2. type hint e retorno declarados conferem com o que o metodo realmente devolve;',
    '3. migration alterada continua reversivel (down() desfaz o que up() faz);',
    '4. property/metodo acessado em model existe de fato, ou esta declarado em @property;',
    '5. nao introduza mass assignment: campo novo entra em $fillable, nunca em $guarded = [].',
  ].join('\n'),
}

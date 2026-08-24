#!/bin/sh
# Item 31: snapshot do volume de estado (cards, diario, worktrees).
#
# Nao roda sozinho e nao apaga nada: retencao e decisao do operador, porque
# apagar backup antigo por default e o tipo de escolha que se descobre errada
# tarde demais. Agende no cron do host se quiser periodicidade.
#
# Uso:  scripts/snapshot-estado.sh [volume] [destino]
set -eu

VOLUME="${1:-hii_estado}"
DESTINO="${2:-./snapshots}"
CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$DESTINO"
docker run --rm \
  -v "${VOLUME}:/estado:ro" \
  -v "$(cd "$DESTINO" && pwd):/destino" \
  alpine:3 \
  tar czf "/destino/estado-${CARIMBO}.tgz" -C /estado .

echo "snapshot: ${DESTINO}/estado-${CARIMBO}.tgz"
echo "skills/ e config/ vivem em git — este snapshot cobre o que NAO esta versionado"

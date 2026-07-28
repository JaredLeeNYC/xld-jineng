#!/usr/bin/env bash
set -euo pipefail

archive="${1:-/var/backups/skill-matrix/database-$(date +%Y%m%d%H%M%S).dump}"
compose_file="${2:-/opt/skill-matrix/compose.yaml}"
mkdir -p "$(dirname "$archive")"
test -f "$compose_file"
umask 077
docker compose -f "$compose_file" exec -T postgres sh -c \
  'pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$archive"
test -s "$archive"
docker compose -f "$compose_file" exec -T postgres pg_restore --list < "$archive" >/dev/null
(cd "$(dirname "$archive")" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
echo "database backup created and verified: $archive"

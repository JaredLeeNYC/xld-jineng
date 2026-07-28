#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: RESTORE_APPROVED=YES restore-database.sh BACKUP TARGET_DATABASE [COMPOSE_FILE]}"
target_database="${2:?target database is required}"
compose_file="${3:-/opt/skill-matrix/compose.yaml}"
created_target=false
on_exit() {
  status=$?
  if test "$status" -ne 0 && test "$created_target" = "true"; then
    echo "partial restore database retained for evidence: $target_database" >&2
    echo "after approval, clean it with: docker compose -f $compose_file exec -T postgres dropdb --username=\"\$POSTGRES_USER\" $target_database" >&2
  fi
}
trap on_exit EXIT
test "${RESTORE_APPROVED:-}" = "YES" || { echo "set RESTORE_APPROVED=YES for an approved maintenance window" >&2; exit 2; }
case "$target_database" in (*[!a-zA-Z0-9_]*) echo "unsafe target database name" >&2; exit 2;; esac
test -f "$archive"
test -f "${archive}.sha256"
test -f "$compose_file"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
docker compose -f "$compose_file" exec -T postgres pg_restore --list < "$archive" >/dev/null
if docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c \
  'psql --username="$POSTGRES_USER" --dbname=postgres --tuples-only --command="select 1 from pg_database where datname='\''$TARGET_DATABASE'\''"' | grep -q 1; then
  echo "target database already exists; restore only supports a new database" >&2
  exit 2
fi
docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c \
  'createdb --username="$POSTGRES_USER" "$TARGET_DATABASE"'
created_target=true
docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c \
  'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE"' < "$archive"
docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c \
  'psql --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" --set ON_ERROR_STOP=1 --command="select count(*) as migrations from drizzle.__drizzle_migrations" --command="select count(*) as accounts from user_accounts"'
migration_count="$(docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c 'psql --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" --tuples-only --no-align --command="select count(*) from drizzle.__drizzle_migrations"')"
account_count="$(docker compose -f "$compose_file" exec -T -e TARGET_DATABASE="$target_database" postgres sh -c 'psql --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" --tuples-only --no-align --command="select count(*) from user_accounts"')"
test "$migration_count" -gt 0 || { echo "restored database has no migration history" >&2; exit 1; }
test "$account_count" -gt 0 || { echo "restored database has no login accounts" >&2; exit 1; }
created_target=false
echo "database restore verified: $target_database"

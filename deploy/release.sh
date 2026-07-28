#!/usr/bin/env bash
set -euo pipefail

version="${1:?usage: RELEASE_APPROVED=YES release.sh VERSION HTTPS_BASE_URL}"
base_url="${2:?HTTPS base URL is required}"
test "${RELEASE_APPROVED:-}" = "YES" || { echo "production release requires RELEASE_APPROVED=YES" >&2; exit 2; }
case "$version" in (*[!a-zA-Z0-9._-]*|'') echo "unsafe release version" >&2; exit 2;; esac
release_dir="/opt/skill-matrix/releases/$version"
current_link="/opt/skill-matrix/current"
previous_target="$(readlink -f "$current_link" 2>/dev/null || true)"
backup_dir="/var/backups/skill-matrix/$version"
environment_file="/etc/skill-matrix/server.env"
test -d "$release_dir"
test -f "$environment_file"
test "$(stat -c '%U' "$environment_file")" = "root" || { echo "server.env must be owned by root" >&2; exit 2; }
case "$(stat -c '%a' "$environment_file")" in 400|600) ;; *) echo "server.env permissions must be 0400 or 0600" >&2; exit 2;; esac
database_url="$(while IFS='=' read -r name value; do if test "$name" = "DATABASE_URL"; then printf '%s' "$value"; fi; done < "$environment_file")"
case "$database_url" in postgres://*|postgresql://*) ;; *) echo "production DATABASE_URL is missing or invalid" >&2; exit 2;; esac
case "$database_url" in *localhost:5433*|*127.0.0.1:5433*) echo "refusing development DATABASE_URL for production migration" >&2; exit 2;; esac
export DATABASE_URL="$database_url"
mkdir -p "$backup_dir"
"$release_dir/deploy/validate-release.sh" "$release_dir"
"$release_dir/deploy/backup-database.sh" "$backup_dir/database.dump"
"$release_dir/deploy/backup-materials.sh" /var/lib/skill-matrix/materials "$backup_dir/materials.tar.gz"
cd "$release_dir"
/usr/local/bin/bun run db:migrate
ln -sfn "$release_dir" "${current_link}.next"
mv -Tf "${current_link}.next" "$current_link"
systemctl restart skill-matrix-server
if ! "$release_dir/deploy/smoke-test.sh" "$base_url"; then
  if test -n "$previous_target"; then
    ln -sfn "$previous_target" "${current_link}.rollback"
    mv -Tf "${current_link}.rollback" "$current_link"
    systemctl restart skill-matrix-server
  fi
  echo "release readback failed; application version rolled back, database restore requires separate approval" >&2
  exit 1
fi
echo "release completed: $version"

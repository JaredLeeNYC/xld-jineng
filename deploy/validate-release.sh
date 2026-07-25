#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:?usage: validate-release.sh /opt/skill-matrix/releases/<release>}"

case "$release_dir" in
  /opt/skill-matrix/releases/*) ;;
  *)
    echo "拒绝校验非标准发布目录：$release_dir" >&2
    exit 2
    ;;
esac

test -f "$release_dir/package.json"
test -f "$release_dir/apps/server/src/index.ts"
test -f "$release_dir/apps/web/dist/index.html"
test -f "$release_dir/packages/db/drizzle/meta/_journal.json"

cd "$release_dir"
/usr/local/bin/bun test
/usr/local/bin/bun run check

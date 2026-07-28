#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-/var/lib/skill-matrix/materials}"
archive="${2:-skill-matrix-materials-$(date +%Y%m%d%H%M%S).tar.gz}"
test -d "$source_dir"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
cp -a "$source_dir/." "$work_dir/"
(cd "$work_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 -r sha256sum > SHA256SUMS)
tar -C "$work_dir" -czf "$archive" .
tar -tzf "$archive" >/dev/null
echo "backup created and readable: $archive"

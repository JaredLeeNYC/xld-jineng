#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: restore-materials.sh BACKUP_ARCHIVE [TARGET_DIR]}"
target_dir="${2:-/var/lib/skill-matrix/materials}"
test -f "$archive"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
tar -xzf "$archive" -C "$work_dir"
(cd "$work_dir" && sha256sum -c SHA256SUMS)
mkdir -p "$target_dir"
cp -a "$work_dir/." "$target_dir/"
rm -f "$target_dir/SHA256SUMS"
echo "restore verified: $target_dir"

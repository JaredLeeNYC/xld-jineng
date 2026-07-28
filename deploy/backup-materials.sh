#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:-/var/lib/skill-matrix/materials}"
archive="${2:-$PWD/skill-matrix-materials-$(date +%Y%m%d%H%M%S).tar.gz}"
archive="$(realpath -m "$archive")"
test -d "$source_dir"
umask 077
mkdir -p -m 700 "$(dirname "$archive")"
if find "$source_dir" \( -type l -o \( ! -type f -a ! -type d \) \) -print -quit | grep -q .; then
  echo "material source contains a link or non-regular object" >&2
  exit 2
fi
if find "$source_dir" -type f -links +1 -print -quit | grep -q .; then
  echo "material source contains a hard-linked file" >&2
  exit 2
fi
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
cp -a "$source_dir/." "$work_dir/"
(cd "$work_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 -r sha256sum > SHA256SUMS)
tar -C "$work_dir" -czf "$archive" .
tar -tzf "$archive" >/dev/null
chmod 600 "$archive"
(cd "$(dirname "$archive")" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
chmod 600 "${archive}.sha256"
echo "backup created and readable: $archive"

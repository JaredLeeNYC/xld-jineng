#!/usr/bin/env bash
# Install the local renderer; uploaded files never leave this host.
set -euo pipefail
if ! command -v soffice >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y libreoffice-headless libreoffice-writer libreoffice-calc libreoffice-impress
    dnf install -y 'google-noto*cjk*'
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk
  else
    echo "Office preview requires LibreOffice; no supported package manager found" >&2
    exit 1
  fi
fi
soffice --headless --version

# Exercise the renderer as the API user before switching the application.
preview_dir=$(mktemp -d /tmp/skill-matrix-preview-smoke.XXXXXX)
trap 'rm -rf -- "$preview_dir"' EXIT
printf '技能矩阵 Office preview smoke test\n' > "$preview_dir/preview.txt"
chown -R skill-matrix:skill-matrix "$preview_dir"
runuser -u skill-matrix -- timeout 45 soffice \
  "-env:UserInstallation=file://$preview_dir/profile" --headless --nologo \
  --convert-to pdf --outdir "$preview_dir" "$preview_dir/preview.txt"
test -s "$preview_dir/preview.pdf"
head -c 5 "$preview_dir/preview.pdf" | grep -q '%PDF-'
echo "Office preview renderer smoke passed as skill-matrix"

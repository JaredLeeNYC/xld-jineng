#!/usr/bin/env bash
set -euo pipefail

archive="${1:?usage: restore-materials.sh BACKUP_ARCHIVE [TARGET_DIR]}"
target_dir="${2:-/var/lib/skill-matrix/materials-restore-test}"
test "${RESTORE_APPROVED:-}" = "YES" || { echo "set RESTORE_APPROVED=YES for an approved maintenance window" >&2; exit 2; }
target_dir="$(realpath -m "$target_dir")"
case "$target_dir" in
  /var/lib/skill-matrix/materials|/var/lib/skill-matrix/materials-restore-*) ;;
  *)
    test "${ALLOW_UNSAFE_TEST_RESTORE:-}" = "YES" && test -n "${RESTORE_TEST_ROOT:-}" || { echo "restore target must be the production material directory or a controlled restore directory" >&2; exit 2; }
    restore_test_root="$(realpath -m "$RESTORE_TEST_ROOT")"
    case "$target_dir" in "$restore_test_root"/*) ;; *) echo "test restore target escapes RESTORE_TEST_ROOT" >&2; exit 2;; esac
    ;;
esac
test -f "$archive"
test -f "${archive}.sha256"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
maintenance_lock="${target_dir}.maintenance.lock"
if ! mkdir "$maintenance_lock" 2>/dev/null; then
  echo "material storage maintenance lock is already held" >&2
  exit 1
fi
if test -d "${target_dir}.upload-locks" && find "${target_dir}.upload-locks" -type f -print -quit | grep -q .; then
  rmdir "$maintenance_lock"
  echo "active material upload detected; stop the API and retry" >&2
  exit 1
fi
work_dir="$(mktemp -d)"
restore_dir="${target_dir}.restore.$$"
previous_dir="${target_dir}.previous.$$"
cleanup() {
  rm -rf "$work_dir" "$restore_dir"
  if ! test -d "$target_dir" && test -d "$previous_dir"; then
    mv "$previous_dir" "$target_dir"
  fi
  rmdir "$maintenance_lock" 2>/dev/null || true
}
trap cleanup EXIT
while IFS= read -r entry; do
  case "$entry" in
    ..|../*|*/..|*/../*|/*) echo "unsafe archive entry: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$archive")
if tar -tvzf "$archive" | awk 'substr($1,1,1) != "-" && substr($1,1,1) != "d" { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "archive contains a link or non-regular member" >&2
  exit 1
fi
tar -xzf "$archive" -C "$work_dir"
if find "$work_dir" \( -type l -o \( ! -type f -a ! -type d \) \) -print -quit | grep -q .; then
  echo "restored archive contains an unsafe object" >&2
  exit 1
fi
if find "$work_dir" -type f -links +1 -print -quit | grep -q .; then
  echo "restored archive contains a hard-linked file" >&2
  exit 1
fi
(cd "$work_dir" && sha256sum -c SHA256SUMS)
mkdir -p "$target_dir"
rm -rf "$restore_dir"
rm -rf "$previous_dir"
mkdir -p "$restore_dir"
cp -a "$work_dir/." "$restore_dir/"
rm -f "$restore_dir/SHA256SUMS"
(cd "$restore_dir" && sha256sum -c "$work_dir/SHA256SUMS")
if test -d "$target_dir"; then mv "$target_dir" "$previous_dir"; fi
mv "$restore_dir" "$target_dir"
(cd "$target_dir" && sha256sum -c "$work_dir/SHA256SUMS")
rm -rf "$previous_dir"
echo "restore verified: $target_dir"

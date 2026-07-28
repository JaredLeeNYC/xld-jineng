#!/usr/bin/env bash
set -euo pipefail

base_url="${1:?usage: smoke-test.sh https://skill.example.com}"
case "$base_url" in https://*) ;; *) echo "production readback requires HTTPS" >&2; exit 2;; esac
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
curl --fail --silent --show-error "$base_url/api/health" | grep -q '"status":"healthy"'
curl --fail --silent --show-error "$base_url/api/ready" | grep -q '"status":"ready"'
curl --fail --silent --show-error "$base_url/openapi/json" | grep -q '"/api/auth/login"'
curl --fail --silent --show-error "$base_url/" | grep -q '<div id="root"'
test -n "${SMOKE_EMPLOYEE_NUMBER:-}" && test -n "${SMOKE_PASSWORD:-}" || {
  echo "SMOKE_EMPLOYEE_NUMBER and SMOKE_PASSWORD are required for login readback" >&2
  exit 2
}
payload="$(/usr/local/bin/bun -e 'process.stdout.write(JSON.stringify({employeeNumber:process.env.SMOKE_EMPLOYEE_NUMBER,password:process.env.SMOKE_PASSWORD}))')"
response="$(curl --fail --silent --show-error --cookie-jar "$work_dir/cookies" \
  --header 'content-type: application/json' \
  --data "$payload" \
  "$base_url/api/auth/login")"
printf '%s' "$response" | grep -q '"ok":true'
curl --fail --silent --show-error --cookie "$work_dir/cookies" "$base_url/api/auth/session" | grep -q '"ok":true'
echo "post-release health, ready, OpenAPI, static web and login readback passed"

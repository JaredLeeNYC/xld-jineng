#!/usr/bin/env bash
# auto-deploy.sh — push main 后由 GitHub Actions SSH 触发，自动拉取、构建、迁移、重启。
# 前提：deploy/setup-server.sh 已执行过一次，服务器环境已初始化。
set -euo pipefail

REPO_DIR="/opt/skill-matrix/repo"
RELEASES_DIR="/opt/skill-matrix/releases"
CURRENT_LINK="/opt/skill-matrix/current"
ENV_FILE="/etc/skill-matrix/server.env"
COMPOSE_FILE="/opt/skill-matrix/compose.yaml"
MATERIALS_DIR="/var/lib/skill-matrix/materials"
BUN="/usr/local/bin/bun"
EXPECTED_SHA="${1:?usage: auto-deploy.sh <exact-git-sha>}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid release SHA"; exit 1; }

# ── 1. 拉取最新代码 ──
cd "$REPO_DIR"
git fetch origin main
git checkout --detach "$EXPECTED_SHA" --quiet
SHA=$(git rev-parse --short=12 HEAD)
FULL_SHA=$(git rev-parse HEAD)

echo "==> deploying $SHA"

# ── 2. 创建 release 目录 ──
RELEASE_DIR="$RELEASES_DIR/$SHA"
if [ -d "$RELEASE_DIR" ]; then
  echo "release directory already exists; preserve it and use a new release SHA"
  exit 1
fi
mkdir -p "$RELEASE_DIR"
git archive "$FULL_SHA" | tar -x -C "$RELEASE_DIR"

# ── 3. 安装依赖 & 构建 ──
cd "$RELEASE_DIR"
bash "$RELEASE_DIR/deploy/ensure-office-preview.sh"
echo "==> bun install"
"$BUN" install --frozen-lockfile
echo "==> build:web"
"$BUN" run build:web

# ── 4. 提取 DATABASE_URL ──
DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$ENV_FILE")
export DATABASE_URL

# ── 5. 备份数据库（如果 PostgreSQL 已运行） ──
if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q 'Up\|running'; then
  echo "==> backing up database"
  mkdir -p "/var/backups/skill-matrix"
  "$RELEASE_DIR/deploy/backup-database.sh" "/var/backups/skill-matrix/pre-$SHA-$(date +%Y%m%d%H%M%S).dump" "$COMPOSE_FILE"
  STORAGE_PROVIDER=$(sed -n 's/^MATERIAL_STORAGE_PROVIDER=//p' "$ENV_FILE")
  if [ "${STORAGE_PROVIDER:-filesystem}" = "filesystem" ]; then
    STORAGE_DIR=$(sed -n 's/^MATERIAL_STORAGE_DIR=//p' "$ENV_FILE")
    bash "$RELEASE_DIR/deploy/backup-materials.sh" "${STORAGE_DIR:-$MATERIALS_DIR}" "/var/backups/skill-matrix/pre-$SHA-materials-$(date +%Y%m%d%H%M%S).tar.gz"
  fi
else
  echo "PostgreSQL unavailable; refusing migration without backup"
  exit 1
fi

# ── 6. 迁移 ──
echo "==> db:migrate"
"$BUN" run db:migrate

# ── 7. 原子切换 current ──
PREVIOUS_TARGET=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
ln -sfn "$RELEASE_DIR" "${CURRENT_LINK}.next"
mv -Tf "${CURRENT_LINK}.next" "$CURRENT_LINK"
echo "==> current -> $RELEASE_DIR"

# ── 8. 重启服务 ──
systemctl restart skill-matrix-server

# ── 9. 健康回读 ──
echo "==> health check"
HEALTH_OK=false
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"status":"healthy"' && \
     curl -fsS http://127.0.0.1:3000/api/ready 2>/dev/null | grep -q '"status":"ready"'; then
    HEALTH_OK=true
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" = "true" ]; then
  echo "==> health check passed"
  echo "==> ready check passed"
  echo "==> applying reviewed manager account changes"
  "$BUN" packages/db/scripts/promote-reviewed-managers.ts </dev/null
  "$BUN" packages/db/scripts/grant-reviewed-factory-read.ts </dev/null
  echo "==> factory read permission verified $FULL_SHA"
  echo "==> reviewed accounts verified $FULL_SHA"
  echo "$FULL_SHA" > "$CURRENT_LINK/.deployed-sha"
  echo "==> deployed $SHA successfully; reviewed accounts verified"
else
  echo "==> health check FAILED"
  if [ -n "$PREVIOUS_TARGET" ]; then
    echo "==> rolling back to $PREVIOUS_TARGET"
    ln -sfn "$PREVIOUS_TARGET" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
    systemctl restart skill-matrix-server
    echo "==> rolled back"
  fi
  exit 1
fi

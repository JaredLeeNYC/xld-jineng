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

# ── 1. 拉取最新代码 ──
cd "$REPO_DIR"
git fetch origin main
git checkout main --quiet
git reset --hard origin/main --quiet
SHA=$(git rev-parse --short=12 HEAD)
FULL_SHA=$(git rev-parse HEAD)

echo "==> deploying $SHA"

# ── 2. 创建 release 目录 ──
RELEASE_DIR="$RELEASES_DIR/$SHA"
if [ -d "$RELEASE_DIR" ]; then
  echo "    release dir exists, replacing..."
  rm -rf "$RELEASE_DIR"
fi
mkdir -p "$RELEASE_DIR"
rsync -a --exclude=node_modules --exclude=.git --exclude=apps/web/dist "$REPO_DIR/" "$RELEASE_DIR/"

# ── 3. 安装依赖 & 构建 ──
cd "$RELEASE_DIR"
echo "==> bun install"
"$BUN" install --frozen-lockfile
echo "==> build:web"
"$BUN" run build:web

# ── 4. 提取 DATABASE_URL ──
DATABASE_URL=$(awk -F= '/^DATABASE_URL=/{print $2}' "$ENV_FILE")
export DATABASE_URL

# ── 5. 备份数据库（如果 PostgreSQL 已运行） ──
if docker compose -f "$COMPOSE_FILE" ps postgres 2>/dev/null | grep -q 'Up\|running'; then
  echo "==> backing up database"
  mkdir -p "/var/backups/skill-matrix"
  "$RELEASE_DIR/deploy/backup-database.sh" "/var/backups/skill-matrix/pre-$SHA-$(date +%Y%m%d%H%M%S).dump" "$COMPOSE_FILE" || \
    echo "    WARN: backup failed, continuing"
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
  if curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"status":"healthy"'; then
    HEALTH_OK=true
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" = "true" ]; then
  echo "==> health check passed"
  # ready 探针
  if curl -fsS http://127.0.0.1:3000/api/ready 2>/dev/null | grep -q '"status":"ready"'; then
    echo "==> ready check passed"
  else
    echo "    WARN: ready check not passed yet (may need migration or DB warmup)"
  fi
  echo "==> deployed $SHA successfully"
  echo "$FULL_SHA" > "$CURRENT_LINK/.deployed-sha"
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
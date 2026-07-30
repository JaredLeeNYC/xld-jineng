#!/usr/bin/env bash
# setup-server.sh — 首次在 tc-stage 上初始化技能矩阵运行环境。
# 只运行一次；后续部署由 auto-deploy.sh 通过 GitHub push 触发。
set -euo pipefail

DOMAIN="skills.xinglianda.cn"
REPO_URL="https://github.com/JaredLeeNYC/xld-jineng.git"
REPO_DIR="/opt/skill-matrix/repo"
RELEASES_DIR="/opt/skill-matrix/releases"
CURRENT_LINK="/opt/skill-matrix/current"
CONFIG_DIR="/etc/skill-matrix"
MATERIALS_DIR="/var/lib/skill-matrix/materials"
COMPOSE_FILE="/opt/skill-matrix/compose.yaml"
SYSTEMD_UNIT="/etc/systemd/system/skill-matrix-server.service"
NGINX_CONF="/etc/nginx/conf.d/skill-matrix.conf"
BUN_BIN="/usr/local/bin/bun"
INITIAL_PASSWORD="${SEED_INITIAL_PASSWORD:-ChangeMe123!!}"
PG_PORT="5432"

echo "================================================"
echo "  技能矩阵系统 — tc-stage 首次初始化"
echo "  域名: $DOMAIN"
echo "  仓库: $REPO_URL"
echo "================================================"

# ── 1. 创建用户 ──
echo "==> [1/10] 创建 skill-matrix 用户"
if ! id skill-matrix &>/dev/null; then
  useradd -r -d /opt/skill-matrix -s /sbin/nologin skill-matrix
fi

# ── 2. 安装 Bun ──
echo "==> [2/10] 安装 Bun"
if [ ! -x "$BUN_BIN" ]; then
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"
  # bun 安装到 ~/.bun/bin/bun（root 用户）
  cp /root/.bun/bin/bun "$BUN_BIN"
  chmod +x "$BUN_BIN"
fi
echo "    bun: $($BUN_BIN --version)"

# ── 3. 创建目录结构 ──
echo "==> [3/10] 创建目录结构"
mkdir -p "$RELEASES_DIR" "$CONFIG_DIR" "$MATERIALS_DIR" /var/backups/skill-matrix
chown -R skill-matrix:skill-matrix /opt/skill-matrix
chown skill-matrix:skill-matrix "$MATERIALS_DIR"

# ── 4. 克隆仓库 ──
echo "==> [4/10] 克隆仓库"
if [ -d "$REPO_DIR/.git" ]; then
  cd "$REPO_DIR" && git pull --ff-only origin main
else
  rm -rf "$REPO_DIR"
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi
chown -R skill-matrix:skill-matrix "$REPO_DIR"

# ── 5. PostgreSQL ──
echo "==> [5/10] 配置 PostgreSQL"
# 生成强密码
PG_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
cat > "$CONFIG_DIR/postgres.env" <<EOF
POSTGRES_DB=skill_matrix
POSTGRES_USER=skill_matrix
POSTGRES_PASSWORD=$PG_PASSWORD
EOF
chmod 600 "$CONFIG_DIR/postgres.env"
chown root:root "$CONFIG_DIR/postgres.env"

# 安装 compose 文件
cp "$REPO_DIR/deploy/compose.postgres.yaml" "$COMPOSE_FILE"

# 启动 PostgreSQL
docker compose -f "$COMPOSE_FILE" up -d postgres
echo "    等待 PostgreSQL 就绪..."
for i in $(seq 1 20); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U skill_matrix -d skill_matrix &>/dev/null; then
    echo "    PostgreSQL 就绪"
    break
  fi
  sleep 2
done

# ── 6. 生产环境配置 ──
echo "==> [6/10] 生成 server.env"
cat > "$CONFIG_DIR/server.env" <<EOF
APP_URL=https://$DOMAIN
DATABASE_URL=postgres://skill_matrix:$PG_PASSWORD@127.0.0.1:$PG_PORT/skill_matrix
HOST=127.0.0.1
PORT=3000
MATERIAL_STORAGE_DIR=$MATERIALS_DIR
SEED_INITIAL_PASSWORD=$INITIAL_PASSWORD
EOF
chmod 600 "$CONFIG_DIR/server.env"
chown root:root "$CONFIG_DIR/server.env"
echo "    server.env 生成完成 (权限 $(stat -c '%a' "$CONFIG_DIR/server.env"))"

# ── 7. systemd service ──
echo "==> [7/10] 安装 systemd service"
cp "$REPO_DIR/deploy/skill-matrix-server.service" "$SYSTEMD_UNIT"
systemctl daemon-reload
systemctl enable skill-matrix-server

# ── 8. Nginx 站点 ──
echo "==> [8/10] 配置 Nginx"
cat > "$NGINX_CONF" <<'EOF'
server {
    listen 80;
    server_name skills.xinglianda.cn;

    root /opt/skill-matrix/current/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /openapi {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
nginx -t && systemctl reload nginx

# ── 9. 首次部署 ──
echo "==> [9/10] 首次部署"
"$REPO_DIR/deploy/auto-deploy.sh"

# ── 10. seed 演示账号 ──
echo "==> [10/10] Seed 演示账号"
cd "$CURRENT_LINK"
export $(cat "$CONFIG_DIR/server.env" | xargs)
"$BUN_BIN" run db:seed
echo "    演示账号已创建（EMP001/MGR001/HR001/VIEW001/ADMIN001）"
echo "    初始密码: $INITIAL_PASSWORD（首次登录后请修改）"

# ── HTTPS ──
echo "==> 申请 Let's Encrypt 证书"
if command -v certbot &>/dev/null; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
    echo "    WARN: certbot 失败，DNS 可能尚未生效，后续可手动运行 certbot --nginx -d $DOMAIN"
fi

echo ""
echo "================================================"
echo "  初始化完成"
echo "  API:  http://127.0.0.1:3000/api/health"
echo "  Web:  https://$DOMAIN"
echo "  仓库: $REPO_DIR"
echo "  配置: $CONFIG_DIR/server.env (0600)"
echo "  后续 push main 自动部署"
echo "================================================"
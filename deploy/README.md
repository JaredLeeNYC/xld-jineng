# 单机云部署模板

本模板适合与参考系统一致的单台 Linux 云主机部署：Nginx 提供静态页面和反向代理，systemd 管理 Bun API，Docker Compose 只运行 PostgreSQL。

## 发布护栏

1. 每次发布解压到 `/opt/skill-matrix/releases/<版本>`，不要直接覆盖 `current`。
2. 复制两个 `.env.example` 到 `/etc/skill-matrix/`，替换密码和域名；不要提交真实密钥。
3. 在候选发布目录执行 `deploy/validate-release.sh`。脚本会拒绝标准发布目录之外的路径，并运行完整测试和检查。
4. 验证通过后才切换 `/opt/skill-matrix/current` 软链接，再重启 `skill-matrix-server`。
5. 重启后必须检查 `/api/health` 与 `/api/ready`；后者会单独报告数据库不可达或迁移不一致。
6. 保留上一版本目录。若探针失败，将 `current` 指回上一版本并重启服务。

## 首次安装

- `compose.postgres.yaml` 安装为 `/opt/skill-matrix/compose.yaml`。
- `skill-matrix-server.service` 安装到 `/etc/systemd/system/`。
- `nginx-skill-matrix.conf` 安装到 Nginx 站点目录。
- Bun 固定使用项目 `packageManager` 声明的版本。

数据库迁移由 systemd 的 `ExecStartPre` 在 API 启动前执行。Drizzle 的迁移记录保证重复执行安全；应用就绪探针同时核对已执行迁移数量。

# 单机云部署模板

本模板适合与参考系统一致的单台 Linux 云主机部署：Nginx 提供静态页面和反向代理，systemd 管理 Bun API，Docker Compose 只运行 PostgreSQL。

## 发布护栏

1. 每次发布解压到 `/opt/skill-matrix/releases/<版本>`，不要直接覆盖 `current`。
2. 复制两个 `.env.example` 到 `/etc/skill-matrix/`，替换密码和域名；设置属主 `root:root`、权限 `0600` 并用 `stat` 复核，不要提交或在验收记录中粘贴真实密钥。
3. 在候选发布目录执行 `bun install --frozen-lockfile`，构建 Web，并以固定版本号显式运行 `RELEASE_APPROVED=YES deploy/release.sh <版本> https://<域名>`；普通主干 push 不触发生产发布。
4. 发布脚本先校验代码和迁移，再分别备份数据库与附件；随后显式执行迁移、原子切换 `current` 并重启 API。
5. 重启后自动读回 health、ready、OpenAPI、静态 Web、登录和会话；失败会回切上一应用版本。数据库回退必须另开维护窗口，经批准执行恢复，不自动破坏生产数据。
6. 固定保留上一版本目录和本次双备份。真实版本号、操作者、备份路径、读回结果写入上线验收记录。

## 首次安装

- `compose.postgres.yaml` 安装为 `/opt/skill-matrix/compose.yaml`。
- `skill-matrix-server.service` 安装到 `/etc/systemd/system/`。
- `nginx-skill-matrix.conf` 安装到 Nginx 站点目录。
- Bun 固定使用项目 `packageManager` 声明的版本。

数据库迁移只由 `release.sh` 在完成双备份后显式执行，普通服务重启不迁移 schema。Drizzle 迁移记录保证重复执行安全；应用就绪探针核对迁移 hash，而非只比较数量。

## 数据库备份与恢复

- `backup-database.sh` 通过 Compose 内 PostgreSQL 生成 custom-format dump，同时生成 SHA-256 并执行目录读回。
- `restore-database.sh` 只允许恢复到一个不存在的新数据库，要求 `RESTORE_APPROVED=YES`，恢复后读回迁移和账号数量。切换生产连接字符串是后续独立审批动作。
- 数据库与附件必须来自同一维护窗口；恢复演练需要在隔离目录和隔离数据库中验证登录、证据文件下载，再决定是否切换。

## 培训资料持久化与备份

- 生产环境将 `MATERIAL_STORAGE_DIR` 固定为 `/var/lib/skill-matrix/materials`，该目录位于 `/opt/skill-matrix/releases` 发布目录之外，切换版本不会覆盖附件。
- 发布前执行 `deploy/backup-materials.sh /var/lib/skill-matrix/materials /var/backups/skill-matrix-materials.tar.gz`。
- 恢复前必须进入维护窗口并停止 `skill-matrix-server`。恢复演练执行 `RESTORE_APPROVED=YES deploy/restore-materials.sh /var/backups/skill-matrix-materials.tar.gz /var/lib/skill-matrix/materials-restore-test`；脚本默认只指向隔离恢复目录、持有维护锁、拒绝活动上传，并在原子切换前后逐文件校验 SHA-256。
- 数据库与附件归档必须取自同一维护窗口。孤儿对象通过数据库存储键对账清理，不允许依据原始文件名删除文件。
- 每日低峰通过 cron 执行 `cd /opt/skill-matrix/current && bun run materials:cleanup`，清理无数据库引用的对象及超过 24 小时的中断上传临时文件。

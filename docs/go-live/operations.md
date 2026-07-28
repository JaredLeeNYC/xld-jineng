# 云端发布与恢复操作说明

生产结构固定为 Nginx 同源静态托管与反向代理、systemd Bun API、Docker Compose PostgreSQL；每个工厂独立部署。生产发布不绑定 Git push，必须由获批人员在维护窗口使用固定版本目录显式触发。

## 发布

1. 将构建产物放入 `/opt/skill-matrix/releases/<版本>`，执行 `bun install --frozen-lockfile` 和 `bun run build:web`。
2. 在 `/etc/skill-matrix/server.env` 配置生产 `APP_URL`、`DATABASE_URL` 和持久化 `MATERIAL_STORAGE_DIR`；`server.env` 与 `postgres.env` 必须为 `root:root`、权限 `0600` 并用 `stat` 复核，真实值不得写入仓库或验收记录。
3. 导出只用于冒烟的低权限账号环境变量 `SMOKE_EMPLOYEE_NUMBER`、`SMOKE_PASSWORD`，运行 `RELEASE_APPROVED=YES deploy/release.sh <版本> https://<域名>`。
4. 保存脚本输出、数据库/附件 SHA-256、迁移 hash、读回结果和审批单号。
5. 发布结束立即清除当前 shell 中的冒烟凭证，按组织安全策略轮换该账号密码。

## 恢复演练

1. 停止写入并记录维护窗口起止时间，分别运行 `backup-database.sh` 与 `backup-materials.sh`。
2. 使用 `RESTORE_APPROVED=YES restore-database.sh <dump> <全新隔离数据库>` 恢复数据库；脚本拒绝覆盖现有数据库。
3. 将附件恢复到 `/var/lib/skill-matrix/materials-restore-test`，逐文件校验 SHA-256。
4. 设置 `RESTORE_DATABASE_URL`、`RESTORE_MATERIAL_DIR`、`RESTORE_EMPLOYEE_NUMBER`、`RESTORE_PASSWORD` 后执行 `bun run restore:verify`，脚本会验证账号密码并下载一份证据/资料核对 SHA-256；再使用临时 server.env 启动 API 完成 ready、矩阵和审计读回。
5. 演练通过后销毁隔离实例；真正生产切换必须重新审批。不要把 restore 脚本当成普通回滚按钮。

## 日常运维

- 每日低峰执行数据库与附件双备份，保留策略由工厂运维制度确定并定期验证可读。
- 每日执行 `bun run materials:cleanup` 对账孤儿对象；不按原始文件名删除附件。
- 系统管理员在“审计日志”查看登录安全、业务变更、停用、作废、导出和通知重试。
- 企业微信失败只在发送记录中重试，不通过重放培训或评定业务来补消息。

## 企业微信与站内通知验收取证

真实云端部署完成且业务全链路已经产生站内通知后，由获批上线人员在安全终端设置以下临时环境变量，再运行 `bun run acceptance:wecom`：

- `ACCEPTANCE_APPROVED=YES`
- `ACCEPTANCE_BASE_URL=https://<生产域名>`
- `ACCEPTANCE_ADMIN_EMPLOYEE_NUMBER`、`ACCEPTANCE_ADMIN_PASSWORD`：系统管理员验收账号
- `ACCEPTANCE_EMPLOYEE_NUMBER`、`ACCEPTANCE_EMPLOYEE_PASSWORD`：已完成培训和评定链路的员工账号
- `ACCEPTANCE_WECOM_WEBHOOK_URL`：生产管理群机器人完整地址
- `ACCEPTANCE_EXPECTED_NOTIFICATION_TYPES=training_published,assessment_archived`：本次链路应产生的通知类型
- `ACCEPTANCE_EVIDENCE_DIR=/var/lib/skill-matrix/acceptance-evidence`：仓库之外、受限访问的证据目录

脚本会真实发送一条测试消息，使用无效 key 验证失败与人工重试，核对对应审计和员工站内通知，并自动停用本次创建的两个临时通道。输出 JSON 不含密码、Cookie、Webhook URL、key、通知正文或失败详情。运行后仍须由现场人员核对群内消息，将接收截图、审批单号和 JSON 路径登记到验收清单；脚本成功不能代替人工接收确认。结束后立即清除当前 shell 中的全部 `ACCEPTANCE_*` 变量并按安全制度处理账号密码。

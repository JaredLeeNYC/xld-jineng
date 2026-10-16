# 技能矩阵系统

面向单工厂独立部署的技能与培训管理系统。当前工程沿用 `lzb-iot` 的 Bun、Elysia、React、PostgreSQL 和 Drizzle 技术组合，但不包含 IoT 专属模块。

## 本地启动

要求 Bun 1.3.14+ 和 Docker。

```bash
docker compose up -d postgres
bun install
bun run db:migrate
# 将 .env.example 中的 SEED_INITIAL_PASSWORD 换成临时密码后
bun run db:seed
bun run dev:server
bun run dev:web
```

- 管理端：<http://localhost:3101>
- API 健康检查：<http://localhost:3000/api/health>
- 数据库就绪检查：<http://localhost:3000/api/ready>
- OpenAPI：<http://localhost:3000/openapi>

`db:seed` 只创建不存在的演示账号，不会覆盖已有密码。五个首次改密账号为 `EMP001`、`MGR001`、`HR001`、`VIEW001` 和 `ADMIN001`。

不同开发任务需要并行运行数据库时，可使用独立 Compose 项目名与端口覆盖文件，避免共享测试数据。

## 验证

```bash
bun test
bun run check
```

`bun run check` 会启动本项目的 PostgreSQL 容器，在随机命名的临时数据库中执行两次迁移并校验迁移 hash，结束后删除临时数据库；若容器原本未运行，也会自动停止容器。可用 `POSTGRES_CONTRACT_ADMIN_URL` 指向专用测试实例。

## Amp orb 开发环境

`.agents/setup` 安装 `package.json` 锁定的 Bun、锁文件依赖、PostgreSQL 17、LibreOffice 和中文字体，并迁移本地开发库、创建五角色演示账号。Amp 可将准备好的文件系统保存为快照，后续 orb 直接复用；重新执行 setup 也不会重新下载已安装的系统包或覆盖 `.env.local`、已有账号密码。

orb 使用原生 PostgreSQL，不依赖 Docker。数据库由 systemd 管理，只监听本机 5433 端口；关闭持久性保障以加速测试，仅适用于可丢弃的开发数据。`.agents/resume` 在唤醒时快速检查并恢复数据库，不安装依赖。`.env.local` 自动设置 `POSTGRES_CONTRACT_ADMIN_URL`，使 `bun run check` 直接使用本地测试实例；该账号具有创建临时测试库的权限，不能指向生产数据库。

setup 还为独立 orb 设置 `vm.overcommit_memory=1`，允许 Vite Plus 的 Oxc 插件分配器预留稀疏虚拟地址空间，避免小内存、无交换空间机器上的启动崩溃；这不会增加实际可用内存，也不应在共享生产主机上执行。

```bash
amp orb services ensure
bun test
bun run check
```

`services ensure` 根据 `.amp/services.yaml` 启动前后端并输出可访问的 Portal 链接。初始演示密码随机生成在 orb 的 `.env.local` 中，不提交到 Git；首次登录需要改密。不要在 setup 中配置个人登录凭证或生产密钥，它的结果可能被其他项目成员的 orb 复用。

云端部署模板见 [`deploy/README.md`](deploy/README.md)。

上线时同时使用 [`一期上线验收清单`](docs/go-live/acceptance-checklist.md)、[`一周试运行记录`](docs/go-live/trial-run-record.md) 与 [`云端发布与恢复操作说明`](docs/go-live/operations.md)。未来 MES 接入边界见 [`MES v1 集成 ADR`](docs/adr/0002-mes-v1-integration-port.md)。

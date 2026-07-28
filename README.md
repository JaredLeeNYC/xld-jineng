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

云端部署模板见 [`deploy/README.md`](deploy/README.md)。

上线时同时使用 [`一期上线验收清单`](docs/go-live/acceptance-checklist.md)、[`一周试运行记录`](docs/go-live/trial-run-record.md) 与 [`云端发布与恢复操作说明`](docs/go-live/operations.md)。未来 MES 接入边界见 [`MES v1 集成 ADR`](docs/adr/0002-mes-v1-integration-port.md)。

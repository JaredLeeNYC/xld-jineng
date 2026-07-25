# 01 — 建立可运行的云端工程骨架

**What to build:** 交付一套可以本地启动、自动验证并按既定云端方式发布的技能矩阵系统空骨架。用户能打开品牌化响应式页面，运维能读取健康、就绪和 OpenAPI 信息，数据库迁移与前后端连接真实可用。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] Bun workspace 只包含 Web、API、配置、数据库和共享契约边界，不含任何 IoT 专属模块或命名。
- [x] Web 在桌面与手机视口均能打开统一壳层，并显示技能矩阵系统品牌和占位首页。
- [x] API 提供统一成功/失败 envelope、health、ready 和严格 OpenAPI 输出。
- [x] ready 能区分进程存活、数据库不可达和迁移不一致。
- [x] PostgreSQL schema 可以从空库迁移，迁移记录可校验且重复执行安全。
- [x] 本地开发入口能启动 Web、API 和任务隔离数据库，不依赖共享生产资源。
- [x] `bun test` 与单一 `bun run check` 在干净环境通过。
- [x] 云端部署模板沿用参考系统的 Nginx、systemd、Compose PostgreSQL和显式发布护栏，但使用本项目独立名称与路径。

## Answer

已在 `5176161` 与 `a37f6f0` 完成可运行底座、响应式管理端壳层、Elysia/OpenAPI API、PostgreSQL/Drizzle 迁移、hash 就绪校验、真实数据库合同测试和云端部署模板。固定基线双轴复审无剩余问题。

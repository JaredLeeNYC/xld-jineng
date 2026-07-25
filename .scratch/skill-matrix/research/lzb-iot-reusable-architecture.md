# `lzb-iot` 可复用技术架构研究

## 研究口径

- 研究对象：`D:\dev\lzb-iot`
- 只读快照：`e6946ca25f6d7dd00f31ef07cee69a0fca078356`（2026-07-24，`docs(acceptance): 记录自然小时产量端到端验收`）。
- 工作区不是完全干净：`scripts/dev-local.ts` 有未提交修改。本报告没有读取其差异作为架构基线，也未修改 `lzb-iot`。
- 本报告区分“工程模式复用”和“业务代码复制”。`lzb-iot` 自己明确规定它是独立 IoT 产品，并阻止 MES/ERP/MQTT 等业务语义跨产品边界；见 [AGENTS.md](D:/dev/lzb-iot/AGENTS.md:10)。

## 结论摘要

技能矩阵一期适合沿用 `lzb-iot` 的**单仓 Bun workspace + React Web + Elysia API + PostgreSQL/Drizzle + shared 契约包 + Nginx/systemd/Compose 云主机发布**骨架，但不应克隆整个 IoT 仓库再删除功能。

建议的目标结构：

```text
apps/
  web/          React 响应式员工端 + 管理端
  server/       Elysia HTTP API、认证、业务编排
  worker/       可选；仅承担企业微信重试、到期提醒等异步任务
packages/
  config/       Zod 环境配置
  db/           Drizzle schema、迁移、数据库客户端
  shared/       纯业务契约、校验器、固定角色/权限常量
```

一期若通知量很小，`worker` 可以先不独立部署：用 server 内的轻量定时任务加持久化 outbox 即可。切勿保留空壳 `ingester`。

## 1. 原样复用

这里的“原样”指架构与通用组件可以直接搬用并重命名包名/品牌，不包括 IoT 业务实体。

### 1.1 Bun workspace 与包所有权

- 根目录使用 `apps/*`、`packages/*` 两层 workspace，包边界简洁；见 [package.json](D:/dev/lzb-iot/package.json:4)。
- 固定 Bun 版本 `1.3.11`，本地、CI、镜像一致；见 [package.json](D:/dev/lzb-iot/package.json:59) 和 [CI](D:/dev/lzb-iot/.github/workflows/deploy.yml:23)。
- 推荐沿用所有权规则：`packages/db` 管 Drizzle 与迁移，`packages/shared` 管纯契约/校验，`apps/server` 管 HTTP 工作流，`apps/web` 管 UI；原规则见 [AGENTS.md](D:/dev/lzb-iot/AGENTS.md:27)。

### 1.2 后端基础栈与响应契约

- Elysia + `@elysiajs/openapi` + CORS 可以原样使用；依赖见 [apps/server/package.json](D:/dev/lzb-iot/apps/server/package.json:15)。
- API 统一为 `{ ok: true, data }` / `{ ok: false, error }`，service 内部返回 `ServiceResult<T>`，HTTP 层只做状态码映射；规范见 [AGENTS.md](D:/dev/lzb-iot/AGENTS.md:19)，实现见 [packages/shared/src/index.ts](D:/dev/lzb-iot/packages/shared/src/index.ts:30) 与 [apps/server/src/http.ts](D:/dev/lzb-iot/apps/server/src/http.ts:33)。
- OpenAPI `/openapi`、`/openapi/json` 和严格 response schema 的方式可直接沿用；注册点见 [apps/server/src/index.ts](D:/dev/lzb-iot/apps/server/src/index.ts:413)。
- `/api/health`、`/api/ready` 分离，ready 同时校验数据库与迁移版本的模式值得直接保留；路由见 [apps/server/src/index.ts](D:/dev/lzb-iot/apps/server/src/index.ts:514)，迁移漂移检查见 [admin-service.ts](D:/dev/lzb-iot/apps/server/src/services/admin-service.ts:186)。

### 1.3 PostgreSQL、Drizzle 与迁移

- PostgreSQL 17 + Drizzle ORM/Kit 适合单工厂独立部署；依赖及命令见 [packages/db/package.json](D:/dev/lzb-iot/packages/db/package.json:13)。
- DB 客户端和事务辅助器体量小、边界清楚，可直接复用；见 [packages/db/src/client.ts](D:/dev/lzb-iot/packages/db/src/client.ts:6) 与 [packages/db/src/client.ts](D:/dev/lzb-iot/packages/db/src/client.ts:29)。
- UUID 主键、带时区时间戳、显式索引/唯一约束的约定可以原样沿用；通用时间戳见 [schema.ts](D:/dev/lzb-iot/packages/db/src/schema.ts:121)。
- 发布前把 canonical migration journal 与线上 ledger 对比、漂移即 fail-closed 的做法应保留；见 [migration-contract.ts](D:/dev/lzb-iot/packages/db/src/migration-contract.ts:32) 和 [migration-contract.ts](D:/dev/lzb-iot/packages/db/src/migration-contract.ts:95)。

### 1.4 前端技术栈与响应式列表

- React 19、TanStack Query/Router/Form/Table、Tailwind CSS、Base UI/shadcn、Lucide 的组合可以原样沿用；见 [apps/web/package.json](D:/dev/lzb-iot/apps/web/package.json:11)。
- API 同源代理、cookie 携带与 typed client 模式可复用；Vite 代理见 [apps/web/vite.config.ts](D:/dev/lzb-iot/apps/web/vite.config.ts:7)，请求携带 cookie 见 [apps/web/src/api.ts](D:/dev/lzb-iot/apps/web/src/api.ts:157)。
- `SessionGate + React Query` 的登录态管理可作为起点；见 [apps/web/src/auth.tsx](D:/dev/lzb-iot/apps/web/src/auth.tsx:30)。
- 桌面表格 + 手机卡片视图是本项目员工手机端的直接基础：桌面在 `md` 以上展示，手机强制卡片；见 [data-list-view.tsx](D:/dev/lzb-iot/apps/web/src/components/data-table/data-list-view.tsx:49) 和 [data-list-view.tsx](D:/dev/lzb-iot/apps/web/src/components/data-table/data-list-view.tsx:70)。
- 列表统一的 loading/error/empty、服务器分页、批量选择模式可原样复用；见 [data-list-layout.tsx](D:/dev/lzb-iot/apps/web/src/components/data-list/data-list-layout.tsx:125) 与 [data-list-layout.tsx](D:/dev/lzb-iot/apps/web/src/components/data-list/data-list-layout.tsx:208)。

### 1.5 配置、质量门禁与测试方式

- 用 Zod 集中解析环境变量并给开发环境默认值，可直接沿用；见 [packages/config/src/index.ts](D:/dev/lzb-iot/packages/config/src/index.ts:20)。
- 单一 `bun run check` 作为 lint + typecheck 主交付门禁，`bun test` 做行为验证，可直接沿用；见 [package.json](D:/dev/lzb-iot/package.json:16) 与 [vite.config.ts](D:/dev/lzb-iot/vite.config.ts:41)。
- service 单元测试、HTTP `app.handle(Request)` 集成测试、真实 PostgreSQL 合同测试三层方式可复用。现有 server 测试直接创建 app 并验证认证、envelope、分页；见 [server.test.ts](D:/dev/lzb-iot/apps/server/src/server.test.ts:134)、[server.test.ts](D:/dev/lzb-iot/apps/server/src/server.test.ts:285) 和 [server.test.ts](D:/dev/lzb-iot/apps/server/src/server.test.ts:460)。
- CI 固定 Bun、冻结 lockfile、执行 check、校验部署脚本和 Compose 配置的门禁可直接保留；见 [deploy.yml](D:/dev/lzb-iot/.github/workflows/deploy.yml:28)。

### 1.6 云主机发布骨架

- 延续“PostgreSQL 在 Docker Compose；API 与 Nginx 由 systemd/宿主机运行”的部署形态最贴近现有运维；现状见 [deploy/README.md](D:/dev/lzb-iot/deploy/README.md:23)。
- Nginx 同源托管静态 Web、反代 `/api` 与 `/openapi`、SPA fallback 可原样复用；见 [nginx-iot.conf](D:/dev/lzb-iot/deploy/nginx-iot.conf:16)。
- systemd 的 `WorkingDirectory=current`、独立 `.env`、自动重启模式可复用；见 [iot-server.service](D:/dev/lzb-iot/deploy/iot-server.service:8)。
- 主干 push 只做 CI，不自动生产发布；显式 release 锁定 SHA/digest 并保留 previous release 的控制原则应原样保留；见 [deploy/README.md](D:/dev/lzb-iot/deploy/README.md:73)。

## 2. 适配复用

### 2.1 认证必须从“邮箱 + 两角色”改为“工号 + 五固定角色”

可复用：

- scrypt 加盐密码哈希和 timing-safe 校验；见 [packages/db/src/auth.ts](D:/dev/lzb-iot/packages/db/src/auth.ts:5)。
- 随机 session token、数据库只存 token hash、HttpOnly/SameSite cookie；见 [auth-service.ts](D:/dev/lzb-iot/apps/server/src/services/auth-service.ts:75)、[auth-service.ts](D:/dev/lzb-iot/apps/server/src/services/auth-service.ts:215)。
- 停用用户后 session 立即失效的校验思路；见 [auth-service.ts](D:/dev/lzb-iot/apps/server/src/services/auth-service.ts:120)。

必须调整：

- 登录标识从 email 改为唯一 `employeeNo`，员工档案与登录账号建议同一员工 ID 关联，而不是继续使用 `consoleUsers.email`；现有列见 [schema.ts](D:/dev/lzb-iot/packages/db/src/schema.ts:428)。
- 固定角色改为 `employee`、`department_manager`、`hr_training_admin`、`executive_viewer`、`system_admin`。现有权限只有 IoT 两角色，不能照抄；见 [authz.ts](D:/dev/lzb-iot/packages/shared/src/authz.ts:11)。
- 增加首次登录必须改密、管理员重置密码、失败次数/临时锁定、密码更新时间、强制 session 失效。现实现只有凭证错误与 enabled 检查；见 [auth-service.ts](D:/dev/lzb-iot/apps/server/src/services/auth-service.ts:58)。
- 12 小时固定 session 可保留为默认，但应把 TTL 配置化；现值见 [auth-service.ts](D:/dev/lzb-iot/apps/server/src/services/auth-service.ts:17)。

### 2.2 后端模块拆分

`lzb-iot` 的 `apps/server/src/index.ts` 已接近 2,000 行，技能矩阵不要继续把全部路由堆在一个文件。保留 Elysia 组合方式，但按领域拆插件/route module：

- `auth`
- `organization`（部门、岗位、员工）
- `skills`（技能、岗位要求、有效期）
- `training`（材料、任务、员工提交、负责人确认）
- `assessments`（录入、主管确认、HR 归档）
- `matrix-reports`
- `notifications`
- `integrations`

service 继续拥有业务规则，route 只负责协议映射。跨表状态流转必须用 [withTransaction](D:/dev/lzb-iot/packages/db/src/client.ts:29)。

### 2.3 数据模型改为可追溯、默认停用而非删除

沿用 UUID、状态枚举、时间戳、唯一约束，但所有正式业务记录需补：

- `createdBy`、`updatedBy`
- `submittedAt/submittedBy`
- `confirmedAt/confirmedBy`
- `archivedAt/archivedBy`
- `voidedAt/voidedBy/voidReason`
- 必要时 `revision` 或单独 audit log

员工、岗位、技能、资料使用 `enabled/disabled`；已发布培训、完成记录、评定和审批记录禁止物理删除。`lzb-iot` 某些管理服务仍执行物理 delete（例如 [admin-service.ts](D:/dev/lzb-iot/apps/server/src/services/admin-service.ts:399)），这部分不能照搬。

### 2.4 响应式 UI 适配

- 保留壳层、侧边栏、命令搜索、数据列表和 UI primitives，但重新建立技能矩阵的信息架构和中文文案。
- 员工手机首页优先展示“待培训、待提交、即将到期、个人技能”，不把管理后台导航缩小后直接给员工。
- 管理端复用 URL 同步筛选/分页与桌面表格；员工端主要用卡片和明确主操作。
- 权限既在 router 隐藏页面，也必须在 server 强制校验。现有前端按 session permissions 筛路由可作为参考；见 [router.tsx](D:/dev/lzb-iot/apps/web/src/router.tsx:47)。

### 2.5 发布与运维适配

- 从 Compose 删除 EMQX，仅保留 PostgreSQL；如一期采用独立通知 worker，再增加对应 systemd unit。
- 将 `/opt/iot`、service 名、容器名、env 前缀全部替换为技能矩阵专属命名，避免与 IoT 同机冲突。
- 现有 Dockerfile 会把全部 workspace 装入并构建 Web，可作基础；见 [Dockerfile](D:/dev/lzb-iot/Dockerfile:1)。生产路径当前实际偏向宿主机 Bun/systemd，需在实现前确认技能矩阵是否也完全采用这一路径，避免同时维护两套发布方式。
- 发布仍需显式 migration 授权。现有默认生产交付遇到 schema 变更 fail-closed、不自动迁移；见 [deploy/README.md](D:/dev/lzb-iot/deploy/README.md:84)。

## 3. 明确排除

以下均为 IoT 专用，不进入技能矩阵仓库：

- `apps/ingester`
- `apps/edge-adapter`
- MQTT 客户端、topic rule、payload mapping、遥测、设备类型、物模型
- EMQX、`emqx/`、MQTT auth/authorize/event webhook
- `iot-server` / `iot-ingester` 服务名与环境变量
- 设备在线状态、点位新鲜度、计算指标引擎、北向 telemetry/metric API 的业务模型
- IoT seed、IoT OpenAPI 文档、IoT 接入 smoke test
- `CONTEXT.md` 中全部 IoT 领域词汇

不能直接沿用当前角色权限常量，因为其语义是 `southbound:*`、`runtime:*`、`system:*`；见 [authz.ts](D:/dev/lzb-iot/packages/shared/src/authz.ts:1)。

也不建议复制 `apps/server/src/index.ts` 后逐段删除：容易遗留 public path、MQTT 特殊鉴权和 IoT schema。应复用依赖与通用小模块，从新的技能矩阵 route graph 开始。

## 4. 云端附件存储边界

### 4.1 一手证据

`lzb-iot` 没有培训附件/业务文件上传实现：在 `apps`、`packages`、`deploy`、`scripts` 中未找到 multipart、presigned URL、S3/COS/MinIO 或业务 attachment storage。现有备份也只覆盖 Postgres、运行配置、EMQX 数据/日志；见 [backup-host.sh](D:/dev/lzb-iot/scripts/backup-host.sh:94)。

因此，附件能力不能声称“沿用 `lzb-iot` 已有实现”，必须作为技能矩阵新增边界。

### 4.2 推荐接口

在 server 内定义 `ObjectStorage` port，业务模块只能依赖它：

```ts
interface ObjectStorage {
  put(input: PutObjectInput): Promise<StoredObject>;
  getDownload(input: ObjectRef): Promise<DownloadDescriptor>;
  delete(input: ObjectRef): Promise<void>;
}
```

数据库只保存元数据：

- `id`
- `storageProvider`
- `objectKey`
- `originalName`
- `contentType`
- `sizeBytes`
- `sha256`
- `uploadedBy`
- `createdAt`
- `status`

业务表通过 attachment relation 引用元数据，不存文件二进制，不暴露真实主机绝对路径。

### 4.3 一期实现建议

- 云端生产优先接腾讯云 COS（与腾讯云部署环境匹配）；开发/测试提供 local filesystem adapter。
- 下载必须先走业务授权，再由 server 流式返回或签发短时下载地址；资料停用不等于立即删除对象。
- 上传限制允许类型（PDF、Word、PPT、图片）、单文件大小、总量；文件名只作显示，不作 object key。
- 上传完成后再写业务关联；失败或孤儿对象需要定时清理。
- 附件备份/生命周期不能只依赖 Postgres dump。现有备份尚未做 off-host object storage retention；相关缺口在 [tencent-42.md](D:/dev/lzb-iot/docs/deployment/tencent-42.md:202) 已被明确记录。
- 若一期为减复杂度先用云主机挂载目录，仍必须通过同一 adapter，并把附件目录纳入独立备份/恢复读回；否则不满足“与云端 IoT 一样可回滚”的实际要求。

## 5. 未来 MES 集成边界

### 5.1 可借鉴而非照搬的模式

`lzb-iot` 已有“外部消费方 + 单独 Bearer API key + hash 落库 + enabled/disabled + lastUsedAt + 明确授权范围”的北向模式：

- consumer 表仅存 key hash；见 [schema.ts](D:/dev/lzb-iot/packages/db/src/schema.ts:768)。
- key 使用随机值并 hash，禁用后认证立即失败；见 [northbound-consumer-service.ts](D:/dev/lzb-iot/apps/server/src/services/northbound-consumer-service.ts:32) 与 [northbound-consumer-service.ts](D:/dev/lzb-iot/apps/server/src/services/northbound-consumer-service.ts:254)。
- 外部 API 使用独立 Bearer middleware，不依赖控制台 cookie；见 [apps/server/src/index.ts](D:/dev/lzb-iot/apps/server/src/index.ts:295) 和 [apps/server/src/index.ts](D:/dev/lzb-iot/apps/server/src/index.ts:1698)。
- 现有领域原则也是拉模式优先、真实 webhook 合同出现后再增加；见 [CONTEXT.md](D:/dev/lzb-iot/CONTEXT.md:53)。

### 5.2 技能矩阵应预留的最小集成面

一期不实现 MES 同步任务，但从一开始隔离以下 port：

```ts
interface EmployeeDirectorySource {
  pullEmployees(cursor?: string): Promise<EmployeeBatch>;
}

interface TrainingResultSink {
  pushTrainingResult(event: TrainingResultEvent): Promise<DeliveryReceipt>;
}

interface SkillStatusSink {
  pushSkillStatus(event: SkillStatusEvent): Promise<DeliveryReceipt>;
}
```

建议外部 API 命名独立版本空间，例如 `/api/integrations/v1/...`，不要让 MES 直接写核心表，也不要复用员工 cookie。

### 5.3 合同建议

- 以 `employeeNo`、岗位编码、部门编码、技能编码作为稳定业务键，内部 UUID 不作为跨系统合同主键。
- 幂等键：`sourceSystem + sourceEventId`；重复导入/回调必须安全。
- 同步批次记录 received/succeeded/failed、摘要、错误明细和重试次数。
- 明确主数据所有权：一期 Excel/本系统维护；MES 接入后必须逐字段决定谁是 source of truth，不能做无规则双向覆盖。
- API key 只存 hash，支持轮换、停用、`lastUsedAt` 与审计；权限建议按能力 scope（如 `employees:write`、`training-results:read`），不照搬 IoT 的设备/指标 grants。
- 企业微信 webhook 与 MES integration 是两种不同适配器：前者是通知副作用，失败不回滚核心业务；后者涉及主数据/结果合同，必须持久化幂等和同步结果。

## 6. 风险与待确认

### 高优先级

1. **认证需求超出现有实现。** `lzb-iot` 没有首次改密、失败锁定、管理员重置后强制下线。实现前需明确初始密码生成/交付规则和锁定阈值。
2. **附件存储没有可复用实现。** 需要确认腾讯云 COS 是否可用、bucket/域名/CORS/凭证由谁提供；否则一期只能选挂载目录并补齐备份。
3. **生产迁移路径。** 现有生产默认发布不执行 DB migration；技能矩阵一期表结构变化频繁，需要定义“备份—迁移—ready readback—回滚”的明确发布流程。
4. **通知调度可靠性。** 若提醒、企业微信重试只跑在 API 进程内，多实例或重启会重复/遗漏。至少需要 DB outbox、幂等键和抢占机制；是否独立 worker 可后定。
5. **员工数据隐私。** Excel 导入、评定附件、个人技能档案可能含个人信息。需明确附件可见范围、导出权限、日志脱敏和备份保留。

### 中优先级

6. **固定五角色仍需精确到动作。** 需求已确定角色，但尚需形成权限矩阵，尤其部门主管是否可见下属历史评定、HR 能否代员工提交、系统管理员是否默认可看业务数据。
7. **部门主管数据范围。** 不能只做 permission；所有查询还需强制 department scope，且要处理兼职/跨部门/主管变更。
8. **“员工完成培训”并不等于“技能达标”。** 培训完成、评定通过、当前有效技能必须保持三个独立状态，避免矩阵被培训记录直接更新。
9. **Excel 导入事务与错误反馈。** 需要先 dry-run 校验、行级错误、整批/部分提交策略以及重复员工工号处理。
10. **测试数据库隔离。** 现有仓库强调显式 task-local PostgreSQL；技能矩阵应在第一张 DB-backed ticket 就确定测试 DB 创建/清理，而不是共享开发库。

### 低优先级/可二期

11. MES 的真实传输方向、字段和频率尚未确定；一期只做 port、稳定业务键、幂等列和版本化 namespace，不建空的同步 UI。
12. 在线考试、扫码签到、SSO、自定义角色、跨工厂、多租户明确排除一期，不要为了“预留”提前引入通用工作流或租户框架。

## 推荐落地决策

1. 新建精简 workspace，不复制 IoT 业务 app。
2. 直接采用 Bun/Elysia/React/PostgreSQL/Drizzle/TanStack/Tailwind 技术组合。
3. 第一批基础票据优先建立：工程骨架、统一 envelope/OpenAPI、迁移 parity、五角色认证、响应式 shell。
4. 第二批围绕核心闭环建领域模块：组织岗位技能 → 培训双确认 → 评定三级确认 → 矩阵投影。
5. 附件和企业微信都通过 adapter + 持久化记录进入系统；外部失败不破坏核心事务。
6. MES 只预留 integration port、稳定编码、API key/hash 和幂等边界，不实现未经确认的同步流程。

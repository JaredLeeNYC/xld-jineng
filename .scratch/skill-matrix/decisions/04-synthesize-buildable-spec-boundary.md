# 汇总可实施规格边界

Type: task
Status: resolved
Blocked by: 02, 03

## Question

如何把参考架构研究与一期领域模型合并为可由 `/to-spec` 发布、再由 `/to-tickets` 切分的单一规格边界？

## Answer

一期规格定义一套单工厂、单租户、云端独立部署的模块化 Web 系统。工程结构沿用 `lzb-iot` 的 Bun workspace、React/Vite、Elysia、PostgreSQL/Drizzle、共享契约、OpenAPI、响应式列表、统一质量门禁和云主机发布护栏，但从空的技能矩阵 route graph 开始，不复制或保留 MQTT、EMQX、ingester、edge-adapter、遥测、计算指标等 IoT 业务代码。

### 交付边界

```text
apps/
  web/       员工响应式门户与管理端
  server/    HTTP API、认证、领域工作流、定时提醒
packages/
  config/    环境配置
  db/        Drizzle schema、迁移、数据库客户端
  shared/    纯契约、校验、固定角色和权限常量
```

一期采用单 API 实例，不单独部署 worker。到期扫描、站内通知和企业微信重试由 server 定时任务驱动持久化 outbox；Webhook 失败不回滚业务事务。附件通过 `ObjectStorage` 适配器隔离，开发和一期生产先使用发布目录之外的持久化挂载目录并纳入备份，数据库只保存元数据；未来可替换为腾讯云 COS，不改变培训或评定模块。

### 领域模块

1. `auth`：工号密码登录、首次改密、失败锁定、管理员重置、固定五角色、服务端数据范围。
2. `organization`：部门、岗位、员工、岗位任职记录、Excel 导入导出。
3. `skills`：技能项、岗位技能要求、员工当前技能、有效期与差距计算。
4. `training`：轻量资料库、培训计划、员工任务、员工提交、负责人确认、证据附件。
5. `assessments`：线下评定录入、主管确认、HR 归档、退回、作废和复评。
6. `matrix-reports`：个人档案、部门/全厂技能矩阵、四类固定指标、下钻和 Excel 导出。
7. `notifications`：站内通知、企业微信群 Webhook、发送记录、幂等重试。
8. `audit`：关键变更、停用、取消、作废、导出和越权操作留痕。
9. `integrations`：仅保留稳定业务编码、内部 port、幂等字段和 `/api/integrations/v1` 命名边界；一期不实现 MES 同步任务、外部写入页面或空壳同步 UI。

### 必须形成的纵向业务闭环

`岗位技能要求 -> 发布培训 -> 员工查看资料并提交 -> 负责人确认 -> 线下评定录入 -> 部门主管确认 -> HR 归档 -> 员工当前技能与矩阵更新 -> 差距/到期提醒`

培训完成、评定通过和当前有效技能是三个独立状态。员工提交不能直接形成正式培训履历；培训完成不能直接授予技能；只有 `PASSED + ARCHIVED` 且未过期、未作废的评定才能产生当前有效技能。

### 界面边界

- 共用：登录/首次改密、通知中心、个人资料。
- 员工端：我的首页、我的技能、我的培训、我的评定。
- 部门主管：部门 Dashboard、员工与矩阵、培训与任务确认、评定确认。
- HR/培训管理员：组织人员、技能标准、资料库、全厂培训、评定归档、全厂 Dashboard/矩阵/导出。
- 系统管理员：账号与固定角色、Webhook 与发送记录、审计日志和系统设置。
- 高层查看者复用只读 Dashboard、矩阵和导出，不复制页面。

桌面管理列表使用服务器分页表格，手机使用卡片；员工端以手机主操作为优先。所有列表都必须有独立的 loading、error、empty 状态，筛选条件与 Excel 导出口径一致。

### 非功能与发布边界

- API 使用 `{ ok: true, data }` / `{ ok: false, error }`，service 拥有业务规则，route 只映射 HTTP。
- 跨状态、多表更新使用数据库事务；正式记录不物理删除，基础数据只停用。
- `/api/health` 与 `/api/ready` 分离，ready 校验数据库和 migration parity。
- 使用任务隔离的 PostgreSQL 完成 DB 测试；以 `bun test` 和单一 `bun run check` 作为主要交付门禁。
- 沿用 Nginx 同源托管、systemd API、Docker Compose PostgreSQL和显式发布/迁移/回滚流程。
- 密码、Webhook 和未来集成密钥不得明文写入日志或仓库；Webhook URL 仅允许安全的 HTTPS 外发地址。

### 验收边界

规格以领域研究报告中的 10 个场景为行为验收依据，最低上线基线为 50 名员工、3 个岗位、五类角色完成一次真实全链路、企业微信真实测试发送、矩阵与 Excel 口径一致，并连续试运行一周无阻塞日常工作的严重问题。

### 切票原则

`/to-tickets` 必须按可演示的纵向能力切分，而不是按“前端、后端、数据库”横向分工。建议依次形成：

1. 可登录的五角色响应式骨架。
2. 可导入员工并定义岗位技能标准。
3. 可查看初始技能矩阵与差距。
4. 可管理资料并完成培训双确认。
5. 可完成评定三级确认并自动更新矩阵。
6. 可处理有效期、站内通知和企业微信群提醒。
7. 可查看四类指标、下钻和一致导出。
8. 可审计、备份、迁移、部署并完成上线验收。

每张票据都应同时包含必要的 schema、service、API、UI 和自动化验收，避免形成长期不可运行的半成品层。

## Evidence

- [lzb-iot 可复用技术架构研究](../research/lzb-iot-reusable-architecture.md)
- [技能矩阵系统一期领域模型研究](../research/phase-one-domain-model.md)
- [确定技能矩阵系统一期产品边界](01-confirm-phase-one-product-boundary.md)

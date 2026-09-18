# Standards 独立审查

审查 HEAD：`be6ed61a443795c3ef49abeb9316558b46ca8ad1`。

固定基线：`4581e1d2cebad8a3c980146ede04aa5226aac031`；比较命令：`git diff 4581e1d2cebad8a3c980146ede04aa5226aac031...HEAD`。

依据：`AGENTS.md`、`CONTEXT.md`、`docs/adr/0001-single-factory-cloud-architecture.md`、`docs/adr/0002-mes-v1-integration-port.md`。按 code-review 技能 Standards 轴执行，只读业务代码。以下是代码路径分析与可复现步骤，未声称已运行真实数据库复现。后续工作区修复不属于本次固定 HEAD，必须复核增量。

## 硬性标准问题

1. **P1：HR 代提交后可自行审批。** `packages/db/src/training-repository.ts:293` 允许任意 HR 提交他人草稿，`:382` 审批和 `:305` 退回只排除创建人，未记录提交人。复现：主管创建有效计划，HR 提交，再由该 HR 审批，即可发布。违反 `CONTEXT.md`「由非提交人的主管或 HR 在授权范围审批」。应持久化当前提交人并在审批/退回时拒绝同一账号，加入 API/数据库回归。root 已接收此问题，待修复后复测。

2. **P2：新评定经退回修订可绕过 L1–L4 限制。** `apps/server/src/assessment-service.ts:168` 的 update 直接调用允许 L0 的 parse，只有 create (`:112`) 单独拒绝 L0。复现：创建 L1 新评定 → HR 退回 → 原评定人 PUT 相同记录、`level: 0` → 更新为 pending_hr。违反 `CONTEXT.md` 新技能评定 L1–L4 的规则。须区分历史 L0 与新记录修订，补退回重提回归。

3. **P1：岗位转部门与任职创建存在竞态。** `packages/db/src/organization-repository.ts:184–189` 使用 NOT EXISTS 检查空岗，但任职修改在 `:379–381` 查询目标岗位后不锁岗位。两个事务可依次执行：A 验证空岗 P 属旧部门后暂停；B 将 P 转新部门并提交；A 向 P 插入旧部门任职并提交。当前外键只校验 ID 存在，不约束任职部门等于岗位部门，最终数据不一致。违反 `CONTEXT.md`「岗位变更所属部门前须先调整仍在该岗位的任职关系」。应让岗位转部门与全部任职写入路径遵循同一岗位锁协议，或采用数据库约束，并增加双连接并发回归。

## 其余检查

新增正式考核记录使用 restrict 外键；培训计划删除为逻辑删除；岗位要求停用保留记录；全厂读权限在抽查的写入口未直接转换为写角色。未发现本次 diff 新增敏感日志泄漏。路由主要负责鉴权、输入与 HTTP 映射。新列表包含加载、错误、空状态及桌面/手机布局；视觉正确性仍由浏览器验收负责。

Fowler smell 基线均按判断性线索审视，没有另报缺乏具体风险的命名/重复/广泛重构意见；工具已强制项目不重复报告。

结论：Standards 发现 3 项待修复问题（P1 × 2，P2 × 1），当前不能判定通过。

## 岗位并发修复独立复验（2026-09-18）

针对工作区 `organization-repository.ts` 修复运行独立验收：岗位修改先 `SELECT FOR UPDATE`，取得锁后用新 SQL 语句重新检查在岗关系；`changeAssignment` / `confirmImport` 验证岗位时使用 `FOR SHARE OF p,d`，锁持续到事务提交。该顺序避免锁等待前快照遗漏已提交任职。

验收脚本：`packages/db/scripts/organization-concurrency-acceptance-20260918.ts`。运行真实生产 repository；仅在真实 PostgreSQL 加锁语句执行完毕后暂停事务，使用第二连接发起竞争操作，并通过 `pg_stat_activity.wait_event_type = 'Lock'` 确认实际阻塞，非纯 mock 或延时猜测。

执行：`bun run packages/db/scripts/organization-concurrency-acceptance-20260918.ts`。随机隔离库 `skill_matrix_org_race_18000_1789712666084` 完整迁移到 0020，四项全部通过，执行后已删除该库，未操作浏览器验收库。

| 场景 | 实际结果 |
| --- | --- |
| changeAssignment 先取得岗位共享锁 | 任职成功；岗位移动等待后拒绝 |
| 岗位移动先取得排他锁 | 移动成功；旧部门任职等待后拒绝 |
| confirmImport 先取得岗位共享锁 | 导入成功；岗位移动等待后拒绝 |
| 岗位移动先取得排他锁，随后导入 | 移动成功；导入等待后拒绝，人员未创建，预览确认标记回滚 |

每个场景均检查全库当前任职的员工部门、任职部门与岗位部门一致，异常数均为 0。脚本定向 `vp check --no-fmt` 通过，无 lint/type 警告。原问题 3 已修复并独立验收通过；问题 1、2 仍由对应开发/验收路径关闭，本节不代替其结论。

## 最终复核与关闭（2026-09-18）

- **问题 2 已关闭：本 Standards 审查者独立执行。** 审读 service 在修改为 L0 前校验已存在记录等级，repository 同一 UPDATE 增加 `($3<>0 or a.level=0)`，确保服务读取与写入之间并发变化也不能绕过限制。亲自运行 `bun run packages/db/scripts/exam-acceptance-20260918.ts`，退出码 0，31 项全部通过；随机隔离库 `skill_matrix_exam_qa_38880_1789713010110` 已清理。具体新增回归确认新 L1–L4 评定退回后不能改 L0、拒绝后原 L2 保持不变、历史 L0 原值可修订。历史兼容没有成为新记录降级旁路。
- **问题 1 已关闭：依据另一独立审查者 spec_review 的真实 PostgreSQL/HTTP 复验证据，并由本审查者核对报告及修复代码。** 证据归属 `docs/testing/2026-09-18-spec-review.md` 的“独立返修复验”，其中实际运行 `bun run test:postgres` 通过。代理提交用例确认创建人和实际提交人均不得审批/退回，第三位 HR 可审批；持久化 `submitted_by_account_id` 正确。代码在 submit 时写当前提交人，approve/reject 同时排除创建人及 `coalesce(submitted_by_account_id,created_by_account_id)`，迁移 0020 提供兼容回填。本审查者未把他人的运行描述成自己重复运行。
- **问题 3 已关闭：本审查者的四项真实双连接并发验收，证据见上节。**

最终 Standards 状态：原 3 项发现均已修复并有独立复验证据，待修项 0。本结论覆盖该审查的代码与针对性回归；最终完整 `bun run check`、`bun test` 与浏览器视觉验收仍以项目最终门禁记录为准。报告保留初轮失败结论，作为返修闭环历史，不代表当前仍失败。

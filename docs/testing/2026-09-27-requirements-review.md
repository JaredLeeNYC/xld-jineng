# 0927 培训统计与年度计划开发评审

来源：`docs/requirements/2026-09-27/source.json` 第 5、6 行，以及同目录 image1–image6 全部截图；业务词汇以 `CONTEXT.md` 为准。

## 需求与口径

- image3 要求月参训人数、月总时数、月人均及累计人均，但示例分母不一致（85/350≈0.2；1576/272≈5.8）。实现采用固定、可见的当前查询范围在岗人数作分母，年初累计，不复制示例中不一致公式。
- 原培训计划只有起止日期，任务只有实际开始/完成时间；这些可跨多天，不能直接当授课时长。新增明确计划授课小时、每个完成任务实际授课小时，未登记记录单独计数，合计只累计已登记值。
- 计划时数按计划计一次；计划人时＝计划小时×范围内去重参训人数；实际人时按已完成员工任务累计；月参训人数按已完成员工去重。
- 计划归属北京时间开始月份，实际归属北京时间完成月份；历史记录实际完成为空时使用原确认时间。跨年计划实际完成可计入另一年。
- 年度计划包含草稿/待审批/已发布/进行中/已完成，排除取消和逻辑删除；未发布参训人数按当前有效对象预估，发布后按实际分配任务计算。
- 部门以员工当前部门与计划对象部门归属；历史部门快照不存在，不能宣称历史编制口径。分母当前在岗人数，分子保留离职员工正式培训历史；零分母显示 —，无记录展示空态。
- HR、经营查看及全厂只读授权可选全厂或部门；普通主管读取强制自身部门；实际时数登记仅 HR 或本部门指定负责人，factoryRead 不扩写权限。

## 实现文件及入口

|职责|文件|
|---|---|
|纯契约及月度计算|`packages/shared/src/training-analytics.ts`|
|真实 SQL 读取及小时登记审计|`packages/db/src/training-analytics-repository.ts`|
|角色边界及验证|`apps/server/src/training-analytics-service.ts`|
|响应式年度计划、统计及过滤|`apps/web/src/training-analytics.tsx` / `.css`|
|计划小时录入、完成任务小时补登|`apps/web/src/training-management.tsx`|
|计划小时保存与任务小时读取|`apps/server/src/training-service.ts`、`packages/db/src/training-repository.ts`、`packages/shared/src/training-plan.ts`|

集成入口由主智能体维护：GET `/api/reports/training-analytics?year=2026&departmentId=...` → `dashboard(actor, filters)`；PUT `/api/training-tasks/:id/hours` → `registerHours(actor, id, body.actualHours)`。部门概况挂载 `TrainingAnalyticsPanel`。数据库 schema 和迁移由区域开发智能体统一维护。

## 验收清单

- 创建跨周计划填 2 小时，3 名参训员工：计划授课 2、计划人时 6，不能显示跨周日历小时。
- 同员工同月完成两项培训，实际小时分别 1.5/2.5：参训人数 1、实际人时 4；分母 2 时月人均 2。
- 2025-12-31 16:00Z 开始记 2026 年 1 月；1 月 31 日 16:00Z 完成记 2 月。
- 已取消计划和任务不累计；未登记小时明确缺失，不能当作已完成零小时。
- 无当前在岗员工时人均为 —；无年度计划展示“本年度暂无培训计划”。
- 普通主管伪造外部门参数仍只读本部门；全厂只读授权可跨部门读取但不能因此跨部门写小时。
- 完成任务登记实际小时后，任务刷新显示；进入部门概况或点击刷新统计显示更新数值。审计保留旧、新小时。
- 拒绝负数、0、字符串、NaN、无限值、三位小数及数值溢出；历史补录可在完成任务登记实际小时。
- 桌面表格、手机卡片；接口加载/失败重试/空态齐备；部门选项从组织 API 加载，不依赖技能矩阵数据是否存在。

已执行 `bun test apps/server/src/training-analytics-service.test.ts apps/server/src/training-service.test.ts apps/server/src/training-independent-qa.test.ts`：20 pass / 0 fail，79 断言。新增测试验证隔离、只读授权边界、跨年/月、明确时数、缺失、人均和非法小时。真实 PostgreSQL 及整合 HTTP/UI 验收待主智能体和独立验收智能体执行。

## 其他截图审阅

- image1：当前岗位要求右上新增部门过滤。
- image2：统一 L0–L4 文案与 CONTEXT 一致；期望增加 2×2 格子，L0 空、L1 一格、L2 两格、L3 三格、L4 四格。未提供替代等级文案，不应自行改业务等级。
- image4：部门和岗位之间新增子部门/区域过滤；与第 10 行组织人员选填区域需求对应。
- image5：岗位别名统一已被原表标“已完成”，不应默认重新批量修改正式数据。
- image6：组织人员新增子部门/区域入口，并允许员工选填所属区域。

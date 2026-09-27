# 培训模块交叉验收（2026-09-27）

验收者：区域功能开发智能体。受测培训模块由另一开发智能体实现；本次未修改培训业务代码。

## 环境与方法

执行 `bun packages/db/scripts/training-cross-acceptance-20260927.ts`。脚本创建独立临时数据库 `skill_matrix_training_cross_*`，应用全部 Drizzle 迁移，构造两个部门、HR、主管、员工及培训资料与计划，运行真实 PostgreSQL 仓储、业务 service 和 Elysia `app.handle` HTTP 接口；结束后销毁该临时数据库，不连接生产。

## 通过项

1. 创建计划的 plannedHours=2.5 能通过 listPlans 读回；修改为 3.75 后读回一致。
2. 跨两个部门的草稿计划按目标在岗员工计数：全厂 4 人，部门 A 3 人。
3. 已发布计划改用非取消培训任务计数：全厂 3 人，部门 A 2 人，不用部门当前人数替代任务数。
4. 本部门指定负责人主管可登记已完成任务时数；非负责人、跨部门任务、未完成任务均拒绝。
5. factoryRead=true 仅扩展报表读取，不能使主管登记跨部门时数；HR 可登记跨部门任务。
6. 时数修正的审计记录保留 previousHours=1.25 / actualHours=1.5，拒绝的登记未产生成功审计。
7. 普通主管请求部门 B 时仍被强制限定部门 A；全厂查看授权主管可按 B 读取，实际人时分别为 1.5 / 2.5。
8. 组织部门读取提供全厂选项；培训统计 UI 部门选项独立取 `/api/organization/departments`，不从已过滤报表结果推导。
9. GET `/api/reports/training-analytics?year=2026` 返回 200；非法年度返回 422。
10. PUT `/api/training-tasks/:id/hours` 正常登记返回 200；三位小数被 service 拒绝，返回 400。
11. POST `/api/training-plans` 的 plannedHours=4.25 经 HTTP、service、仓储往返保持一致；PATCH 显式 null 后数据库读回 null。
12. 普通员工访问培训统计或登记时数均返回 403。

## 结论

本轮独立数据库与 HTTP 验收全部通过，未发现需回流的缺陷。另运行新脚本的定点 lint/typecheck，清理测试代码的两个未使用变量告警。浏览器视觉、交互验收由主智能体与独立界面验收流程负责。

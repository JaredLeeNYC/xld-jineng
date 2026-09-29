# 2026-09-29 年度培训统计区域筛选开发验证

需求来源：09-29 汇总表第 11 行。前端由 training_modules 智能体负责，本报告覆盖后端、契约和真实数据库验证，不替代后续独立验收。

## 实现

- `GET /api/reports/training-analytics` 增加可选 `areaId` UUID 查询字段，服务向数据库传递区域并在响应回显；共享 `TrainingAnalytics` 增加可选 `areaId`。
- 分母只统计所选部门/区域当前在岗人员，完成任务只读取该范围员工记录；历史离职员工的实际时数继续计入，分母为零时人均为 `null`。
- 已发布计划按未取消任务计算区域参训人数；草稿按当前有效培训对象计算。指定区域但没有匹配参训人员时，计划不进入该区域年度列表或计划时数。
- 无区域筛选继续保留原有行为和年度计量；月份归属、计划时数计一次、计划人时、月参训人员去重均不变。
- 普通主管仍被强制限定本部门；试图组合他部门区域时，计划、任务时数与分母均为空。全厂只读授权仍仅扩大读取范围。

## 已完成验证

- `bun test apps/server/src/training-analytics-service.test.ts`：3 pass / 0 fail，23 个断言。包含区域参数传递、主管部门强制范围、全厂读取、写入权限不扩大及原有计量边界。
- `bun run typecheck`：修复测试对象的 exactOptionalPropertyTypes 后，117 文件通过。
- `bun packages/db/scripts/training-cross-acceptance-20260927.ts`：真实随机 PostgreSQL 临时库，通过；脚本 finally 清理临时库。保留原先全部培训时数断言，并新增区域分母、草稿/发布人数、任务过滤、HTTP 参数与响应、无效 UUID、跨部门保护、全厂读取、离职历史和零分母断言。
- 同一真实数据库脚本额外验证本轮评定契约：列表返回正确 `areaId`/`areaName`，无区域时不伪造字段，主管不能读其他部门评定，停用区域保留历史名称。

首次新增数据库夹具误用了区域表不存在的 `code` 列，已根据真实 schema 改为 `name, department_id`，重跑通过；该失败仅为测试夹具错误。未修改正式数据，未提交或 push。

全部开发与 UI 优化完成后仍需由其他智能体独立验收，并重跑 `bun test`、完整 `bun run check` 和本脚本。

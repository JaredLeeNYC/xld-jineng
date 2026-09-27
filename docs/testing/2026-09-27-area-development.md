# 区域开发验证（2026-09-27）

任务：需求表第 7 行矩阵区域筛选、第 10 行部门下可选子部门 / 区域及员工归属。

## 实现

- departments 下新增 areas，名称在部门内唯一；员工 area_id 可空。未划分区域的原有数据无需改动。
- HR 创建、重命名、停用区域；无物理删除入口。组织页区域列表使用桌面表格 / 手机卡片，提供 loading/error/empty 状态。
- 新增员工可选区域；现有员工可设置或明确清空区域。事务锁定员工及目标区域，拒绝跨部门、停用区域及停用部门；调部门时自动清空旧区域，同部门换岗位保留。
- 技能矩阵支持 areaId；与部门、岗位、员工、技能过滤组合，主管及员工原有权限限制继续强制执行。停用区域历史归属仍显示，可用于矩阵筛选。
- 同批协调迁移添加培训 planned_hours / actual_hours numeric(8,2) nullable 及非负约束，业务实现由培训开发负责。

## API

- GET /api/organization/areas：可选 includeInactive=true，仅 HR 可读取停用项。
- POST /api/organization/areas：{ name, departmentId }。
- PATCH /api/organization/areas/:id：{ name }；不允许更改所属部门。
- POST /api/organization/areas/:id/deactivate：逻辑停用。
- PATCH /api/organization/employees/:id/area：{ areaId: UUID | null }。
- POST /api/organization/employees：原请求增加可选 areaId。
- GET /api/skill-matrix：增加可选 areaId UUID。

## 验证证据

- 红灯：`bun test apps/server/src/area-service.test.ts`，修改前 0 pass / 2 fail，缺少 listAreas、setEmployeeArea。
- 回归：`bun test apps/server/src/area-service.test.ts apps/server/src/organization-service.test.ts apps/server/src/organization-http.test.ts apps/server/src/skill-service.test.ts`，20 pass / 0 fail。
- 真实数据库：`bun packages/db/scripts/area-acceptance-20260927.ts`，在独立临时数据库运行全部迁移后验证跨部门拒绝、正确归属、矩阵筛选、停用区域不可新选且历史保留、调部门清空、显式清空、无物理删除；通过后清理临时数据库。
- `bun run typecheck`：110 files，no type errors。
- 新增代码定点 lint/typecheck：6 files，无警告或错误。

本需求为缺失功能，红灯锁定不存在的真实 service 能力后完成端到端实现；未展开不适用于新增能力的多假设故障定位。后续由独立验收智能体进行 API/界面验收与全量交付门禁。

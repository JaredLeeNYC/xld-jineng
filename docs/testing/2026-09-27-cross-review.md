# 0927 独立交叉验收

验收人：培训统计开发智能体（未开发本次被验收的岗位要求筛选、等级图例、HR 导航及区域模块）。

## 范围与结果

|需求|验证|结果|
|---|---|---|
|当前岗位要求部门过滤|审查 HR `SkillAdminPanel` 独立部门状态，过滤条件匹配 requirement.departmentId；只读 `RequirementsView` 换部门清空岗位状态|代码审查通过；浏览器交互另验|
|L0–L4 能力等级说明|实际组件渲染后逐个图例断言 4 个格子，填充数分别 0/1/2/3/4；原统一文案保留|通过|
|HR 可查看技能矩阵|实际 HR 应用壳渲染含菜单、shared 导航为 read；真实 skill service 接受 HR 跨部门读取|通过|
|矩阵按区域过滤|真实 PostgreSQL 产生两个部门与区域、员工及岗位要求，验证区域 SQL 过滤；组件区域选项含“生产部 · SMT区”|通过|
|员工可选区域|真实 PostgreSQL 验证正确归属、跨部门拒绝、明确清空|通过|
|区域停用与正式数据保留|真实 PostgreSQL 验证停用区域不可新选、原矩阵记录继续显示、areas 行数未减少|通过|
|员工调部门|真实 PostgreSQL 验证调部门清空旧区域，新部门可重新指定|通过|
|只读授权隔离|新独立测试验证 factoryRead 主管跨部门读区域，但创建、重命名、停用、员工区域修改全部拒绝且 repository 写入未调用|通过|
|矩阵范围隔离|新独立测试验证伪造 departmentId/employeeId 与外部 areaId 组合不能覆盖主管部门或员工本人范围|通过|
|列表状态与移动呈现|代码审查 AreaManagement loading/error/empty，桌面表格/mobile cards；RequirementsView 同样齐备|通过，视觉另验|

## 运行证据

1. `bun packages/db/scripts/area-acceptance-20260927.ts`：临时 PostgreSQL 数据库全迁移后运行，输出“区域 PostgreSQL 验收通过：跨部门拒绝、正确归属、矩阵筛选、停用保留、调部门清空、显式清空。”随后清理该临时库。
2. `bun test apps/web/src/requirements-cross-review.test.tsx apps/server/src/area-cross-review.test.ts apps/server/src/area-service.test.ts apps/server/src/organization-http.test.ts apps/server/src/skill-service.test.ts apps/web/src/app.test.tsx`：27 pass、0 fail，113 断言。

独立新增测试文件：`apps/web/src/requirements-cross-review.test.tsx`、`apps/server/src/area-cross-review.test.ts`。本轮没有发现可重复确认的阻断缺陷，因此没有修改被验收模块实现。

## 验收边界

SSR 验证不能证明点击筛选、异步加载及手机实际布局；这些由主智能体浏览器验收负责，不能以以上通过代替。建议最终浏览器操作 HR 当前岗位要求切换两部门、HR 技能矩阵入口、创建区域、员工选填/清空区域及矩阵区域筛选，并检查移动端无横向溢出。全量 `bun test`、`bun run check` 和部署由主智能体统一执行。

培训模块两项补充修正已完成，但不计入本独立验收结论：全厂读取角色默认统计全厂；历史离职记录文案明确属于实际人时分子，当前在岗分母不含离职人员。

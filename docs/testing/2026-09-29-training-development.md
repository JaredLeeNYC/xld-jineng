# 2026-09-29 培训管理开发交付

## 范围与实现

对应需求表第 11、15、16、17、18 行。

- 新增 TrainingWorkspace：年度培训计划汇总表（默认）、计划管理、培训任务、培训资料四个互斥子模块。
- HR、高层查看角色及 factoryRead 账号展示全厂读取入口；普通主管默认本部门。原角色、服务端写权限不变。
- TrainingManagement 支持 view="plans" / "tasks"，原默认 all 保留员工调用兼容；资料复用 MaterialLibrary。
- TrainingAnalyticsPanel 支持 showPlanDetails=false（概况仅统计）、showStatistics=false（管理年度明细）。
- 年度表按部门、区域、月份、状态筛选；部门变化清空区域；区域传入服务端 areaId，由真实人员、计划、任务范围过滤。月份按北京时间计划开始月份匹配；状态与月份交集筛选。
- 年度输入清空或越界时显示明确错误，不请求非法年度；列表包含加载、失败重试、空数据态，桌面表格/手机卡片。
- 新建计划文本、数字、日期、select、多选与完成方式分组新增清晰边框及键盘焦点样式。
- 计划列表解释本人创建/提交计划不可自行审批，独立审批规则保持不变。

## 接口与文件

- apps/web/src/training-workspace.tsx：导出 TrainingWorkspace({session})。
- apps/web/src/training-management.tsx / training-management.css：视图拆分与表单样式。
- apps/web/src/training-analytics.tsx：年度筛选与概况显示开关。
- apps/web/src/training-workspace.test.tsx：北京时间跨月筛选、状态交集、默认子模块、全厂读取和概况选项行为。
- API: /api/reports/training-analytics?year=2026&departmentId=...&areaId=...；区域来自 /api/organization/areas。
- app.tsx 接线由主智能体完成；区域服务端、shared、DB由另一智能体完成。

## 验证

- `bun test apps/web/src/training-workspace.test.tsx`：4 项通过，0 失败，16 条断言。
- `bunx vp check --no-fmt apps/web/src/training-management.tsx apps/web/src/training-workspace.tsx apps/web/src/training-workspace.test.tsx apps/web/src/training-analytics.tsx`：4 文件无类型、lint错误。
- 全仓 typecheck 在并行开发期间报告 app.tsx 及 analytics service test 暂态错误，已通知对应开发者；此报告不代替最终全仓 check 门禁。
- 本任务为新增导航、筛选、显示模式及视觉完善，不宣称修复未复现的主管账号审批异常；审批由专门智能体诊断。

## 交付独立验收

待独立验收真实浏览器四子模块切换、HR/主管读取范围、区域组合筛选、概况明细隐藏、手机卡片及边框；最终统一 UI/UX 改造由另一智能体进行。未提交、未推送。

## 补充：第 12 行主管负责人可见性缺陷（用户澄清后）

真实症状是负责人看不到 HR 提交的两个待审批计划，而非审批按钮执行报错。最小场景：主管 10001 属部门 A、由 HR 提交计划且指定该主管负责，所有参训人属于部门 B；分别覆盖未来计划和历史补录。

### 诊断闭环

1. 已运行 `bun packages/db/scripts/training-owner-visibility-20260929.ts`，真实 PostgreSQL + 正式 service/repository 路径红灯：`AssertionError: designated owner must see HR submitted pending plan even when all targets are outside owner department`。
2. 排序假设：列表漏 owner 读取条件；负责人关联未保存；待审批状态额外过滤。fixture 确认关联、状态均正常，根因为 SQL listPlans 仅 HR/创建人/参训部门/任务部门可见，没有指定负责人条件。
3. listPlans 增加当前有效账号 employee_id 命中该计划 owner_employee_ids 的读取条件。未改变审批、任务列表、任务操作、撤回、取消等授权。
4. 新增 estimatedParticipantCount：按全部有效计划对象去重计数，避免跨部门负责人前端只有本部门员工资料时显示 0 人。新人数断言先红（undefined !== 1），修复后绿。
5. 前端区分可读与可操作：只允许 HR/创建人显示编辑、撤回、取消等维护按钮；跨部门待审批计划显示需非创建人/非提交人 HR 独立审批，隐藏该主管不可用的审批按钮。
6. 默认年度页说明年度表按参训部门统计，提供“查看我负责的计划”入口跳到计划管理；年度统计权限及分母口径保持不变。

### 回归结果

- `bun packages/db/scripts/training-owner-visibility-20260929.ts`：通过。真实数据库断言覆盖未来与历史待审批负责人可见；无关主管不可见；完整预估人数；待审批计划资料负责人可读而无关主管不可读；负责人读取不授权取消、撤回、跨部门审批、跨部门任务开始；独立 HR 审批成功。
- `bun test apps/server/src/training-service.test.ts apps/web/src/training-workspace.test.tsx`：20 通过、0 失败、72 断言。
- 材料读取既有 owner 规则已包含待审批，不需要改写权限；没有将 owner 待审批材料授权用于新建计划的写选择范围。
- 已通知独立审批验收智能体重跑其 HTTP red 场景；独立证据以其报告为准。
- 新增独立测试数据库会在 finally 清理；无生产业务数据变更，没有新增数据库迁移。
- 本次根因预防：保留指定负责人跨参训部门的真实数据库读取/写权限分离契约，避免只测“本部门也在参训范围”的样例掩盖缺陷。

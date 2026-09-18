# 2026-09-18 Spec 独立审查

审查基线：`4581e1d2cebad8a3c980146ede04aa5226aac031`；审查提交 `be6ed61`。使用 `git diff 4581e1d2cebad8a3c980146ede04aa5226aac031...HEAD`，并读取最新工作区以排除已修问题。本轮是来源及代码路径审查；下列复现步骤供返修后真实接口/浏览器验收，不冒充已执行浏览器验证。未修改业务代码。

## 待修发现

### SPEC-01 / P1：多负责人绕过部门授权范围

来源：requirements.md:52：“负责人多选不是扩大其部门数据权限的依据”。旧验收规则 docs/testing/2026-09-08-acceptance-plan.md:9：“主管仅能操作授权范围”。

位置：packages/db/src/training-repository.ts:341、489；apps/server/src/training-service.ts 的 startTask/completeTask。

复现：HR 建立涵盖 A、B 两部门员工的计划，将 A 部门主管添加到负责人数组，另一 HR 审批发布；A 主管调用 GET /api/training-tasks 能看到 B 员工任务，再调用 B 员工任务的 start、complete。读取查询无条件接受负责人数组成员；执行查询只有负责人身份和有效管理账号校验，没有员工所属部门校验，因此两次写入成功，产生 B 员工正式履历。预期 A 主管仅可操作授权范围，HR 可以跨部门执行。负责人以后被降级为普通员工时，listTasks 的无角色负责人分支仍会暴露其他员工任务。

返修：所有新增多负责人读写路径同时约束当前角色/部门；包含角色降级回归。该项针对本次实施约定，不把 DOCX 未定义的审批身份解释成源文硬性规定。

### SPEC-02 / P2：新培训页面丢失历史签到证据的查看入口

来源：requirements.md:56：“旧9月8日已通过事项不因本次原文未重复而移除”；docs/testing/2026-09-08-acceptance-round-2.md:26、44 已验收“培训记录…入口真实打开”“已确认记录和本人证据可见”。

位置：apps/web/src/training-management.tsx:345 的 taskActions（仅资料、历史确认/退回、开始/完成）；实际路由已改用 TrainingManagement。旧 app.tsx 的 TrainingPage 仍包含 task.evidence 预览，但不再挂载。

复现：选有既有签到表/照片 evidence 的已确认任务，员工和管理账号分别打开培训页面，桌面与手机均只有培训资料预览，没有签到证据链接。数据虽未删除，用户无法从原业务入口取回培训完成依据。

返修：恢复所有授权角色桌面/手机的历史证据预览和下载；用已存在 evidence 的任务做验收。未将旧员工“提交完成”列作回归缺陷，因为 X03 已明确替代它；批量完成新行为未在此强行要求恢复。

### SPEC-03 / P3：三类新增/替换列表缺少明确要求的序号

来源：docx-source.txt 的 P81（培训计划）、P139（考核档案）、P205（评定记录）、P236（培训任务）均为“序号”；requirements.md:36 明确考核档案表含序号。

位置：training-management.tsx 计划和任务表头/行；training-exams.tsx:251—286；app.tsx:3874 的评定记录表。

复现：任意非空计划、任务、考核及评定桌面列表，没有序号列。资料库已有序号，其余未实现，无法按需求表逐行编号核对。

返修：上述列表增加显示序号；筛选后的序号行为保持一致。此项仅表字段遗漏，不影响记录主键或排序。

## 合理解释与审查边界

四类培训业务类型与技能分类分离；多文件按文件分行入库、计划再多选资料；删除解释为逻辑移除；新评定保存待 HR 归档及旧记录流转兼容，均有源需求或实施解释支撑，未报告为范围扩大。未重复 Standards 已报告的提交人自审批、退回评定等级和岗位迁移并发问题。当前结论：3 项发现，均需返修并独立复测后关闭。

## 独立返修复验（2026-09-18）

由原 Spec 审查者亲自执行，不以开发自测结果代替：

- `bun run test:postgres`：本机 Docker 沙箱管道初次被拒，正常申请工具沙箱提升后重新执行，退出码 **0**。隔离新数据库完整迁移及真实 HTTP/PostgreSQL 合同通过。审读并实际运行了 postgres-contract.ts:2900—2956 的跨部门负责人/降级用例：主管跨部门 start/complete 均 409，本部门外任务不出现在列表，独立 HR 跨部门执行成功；负责人降为 employee 后仅返回本人任务，管理写操作 403。SQL 的 executeTask 现按实际 accountId 联查当前有效账号、员工及目标部门；listTasks、taskAuthorization、getEvidence 同步去掉跨部门负责人旁路。**SPEC-01 已关闭。**
- 独立执行临时 SSR 探针，用真实 `TrainingManagement` 组件渲染含历史签到 PDF 的员工/HR 数据，验证两个角色桌面与手机 DOM 均有证据预览和下载，各计 2 个；同时验证员工任务序号表头 1 个、HR 计划及任务序号表头 2 个。结果见 `2026-09-18-evidence/spec-ssr-retest.json`。真实 PG 合同原有受权证据下载仍通过。**SPEC-02 已关闭（入口与权限验证通过；视觉浏览器回归由另一独立验收者补充）。**
- **SPEC-03 暂未关闭**：计划和任务序号已独立渲染验证；考核及评定序号待修复落盘后复验，不将尚未落盘的修改计为通过。
- 扩展检查：实际执行代理提交合同（postgres-contract.ts:2848—2897），主管创建、HR 代提交后，创建人及实际提交人均不能自审批/退回，第三位 HR 审批成功；读回 submitted_by_account_id 与 created_by_account_id 不同且正确。新迁移将有 submitted_at 的旧记录保守回填创建人，避免旧数据空字段绕过。
- 材料 UUID 边界：真实 HTTP 合同实际执行主管用其他部门未授权材料 UUID 建计划返回 409；本人无技能关联资料可正常使用，未把关联技能选填改回必填。代码审读确认 validateDraft（创建/编辑）和 publish（审批）都调用相同 selectableMaterials 权限查询，factoryRead 未被当成写入角色传入。

浏览器限制：此审查者两次调用 cua.getState 均返回 `Unable to load browser request-header policy`，没有伪称执行视觉验收；上述 UI 证据明确是 SSR 组件渲染，不等同于浏览器点击/视觉测试。

### 最终补验与关闭

baseline 修复落盘后，本审查者再次独立执行 `bun packages/db/scripts/exam-acceptance-20260918.ts`，退出码 **0**，真实隔离 PostgreSQL/HTTP 的 **31 项全部通过**，包含新评定退回后改 L0 被拒、拒绝后原等级仍为 L2、旧 L0 记录维持原值可修订；代码另检查服务的旧值校验及 SQL 同一更新语句 `($3<>0 or a.level=0)` 双重保护。未只依赖 UI 下拉框防护。

新建独立 SSR 探针，实际导入并渲染 `TrainingExamsPage`、`AssessmentPanel`，分别验证非空数据的 `<th>序号</th>`、首行 `<td>1</td>` 和手机标题 `1. 验收员工`，两组件均通过。证据：`2026-09-18-evidence/spec-exam-assessment-ssr-retest.json`。结合前述计划/任务组件渲染结果，**SPEC-03 已关闭**。

本报告所有 3 项 Spec 发现已完成修复及独立针对性复验，当前无待修 Spec 发现。浏览器视觉回归由项目独立 UI 验收报告记录；本报告不替代该部分验收，也不代替最终完整门禁。

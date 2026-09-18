# 培训考核与技能评定独立验收 第一轮

验收者未开发培训考核与评定模块。依据 `docs/requirements/2026-09-18/requirements.md` 的 X04、D07—D10，以及全厂只读与历史保护规则。本轮不修改受验业务代码，失败直接发给开发智能体 baseline 并抄送主智能体。

## 当前结论

第一轮发现5项问题均已返修。服务层及真实数据库/HTTP复测通过：专用脚本共27项检查全部通过，覆盖无证据归档、独立复核、旧流程、隐私与成绩关联。QAE-02未来日期前端逻辑已静态核验，仍需浏览器交互复验；桌面/手机视觉与操作验收不在这27项声明范围内。

## 问题与复现

| ID | 严重度 | 复现步骤 | 预期 | 第一轮实际 | 返修及复测 |
|---|---|---|---|---|---|
| QAE-01 | P1 | 主管调用新建评定，level=0，其余合法 | 新录入只接受L1—L4，历史L0保留 | parse仅isSkillLevel，允许0 | baseline已在create拒绝0；独立service探针确认400；真实DB复测通过 |
| QAE-02 | P2 | 前端选择未来评定日期2026-10-01后保存（当前2026-09-18） | 明确拒绝未来日期，保留输入 | 提交表达式将任何未来日期静默替换为now | baseline增加提交前日期检查；静态确认；浏览器验收待执行 |
| QAE-03 | P1 | 旧HR录入→独立主管确认→HR退回→HR改分数/等级→原HR归档 | 当前版本必须独立复核，修订使旧确认失效 | update保留manager_confirmed字段，archive接受旧确认，HR可自归档新版 | baseline清空修订时旧确认字段；真实DB确认原HR归档拒绝，另一HR成功 |
| QAE-04 | P2 | factoryRead主管查看其他部门评定列表后预览其证据 | 只读权限在列表和证据一致；不能越权修改 | list转executive_viewer而evidenceContent仍department_manager范围 | baseline统一只读scope；独立探针确认两操作都executive_viewer，写权限未扩大 |
| QAE-05 | P1 | 新随机空库执行全部迁移，主管提交合法L2评定，不上传证据 | 保存为pending_hr并可由独立HR归档 | PostgreSQL 23514 skill_assessments_manual_complete，旧check仍要求证据；service裸调用抛错 | root已纳入0019约束更新；实际multipart HTTP无证据创建及独立HR归档均通过 |

## 已执行证据

- `bun test apps/server/src/assessment-service.test.ts apps/server/src/training-exam-service.test.ts`：9通过，0失败，32断言。
- `.scratch/requirements-20260918/exam-qa-probe.ts`：QAE-01返修后返回400；QAE-04列表/证据两scope均executive_viewer。
- `bun packages/db/scripts/exam-acceptance-20260918.ts`：创建唯一随机临时数据库，运行实际Drizzle迁移，实际HTTP handler+PostgreSQL考核操作，结束清理临时数据库，不修改现有开发/生产库。第一轮已依次通过：考核HTTP创建、82.5分精度和时间读回、跨部门录入拒绝、员工录入拒绝、未来时间拒绝、非计划技能拒绝、员工仅本人档案。随后无证据创建触发QAE-05。
- HTTP验收使用固定Session夹具隔离认证，真实执行路由输入校验、service和PostgreSQL；不替代登录模块已有合同测试。

## 下一轮覆盖

返修后同脚本复跑（随机库 `skill_matrix_exam_qa_35448_1789710910960`，执行后已清理）27项全部通过：考核HTTP与持久化、分数和时间、跨部门考核拒绝、员工录入拒绝、未来时间拒绝、非关联技能拒绝、个人考核隐私、multipart无证据评定、直接待HR归档、自动关联分数、待归档不生效、主管归档拒绝、独立HR归档、有效技能更新、L0拒绝、手动成绩覆盖、HR自归档拒绝、第二HR归档、个人评定隐私、跨部门评定拒绝、错员工考核关联拒绝、考核晚于评定拒绝、旧主管确认、旧记录修订、修订后清除旧确认、再次独立归档、未通过不升级。

仍需浏览器验证未来日期提示、员工个人档案入口、桌面表与手机卡片及空态/错误态。

## 浏览器复验与追加返修

- QAE-06（P2）：完成计划的资料停用/逻辑归档后，考核UI从当前资料库推导技能导致下拉为空。baseline与training_dev改为计划携带历史materials.skillIds；无绑定技能课程允许明确选择有效技能。专用DB脚本增加此分支后28项全通过，原有关联课程仍拒绝不匹配技能。
- QAE-07（P2）：考核表单原来使用未定义master-form样式，桌面控件挤成两行。baseline增加独立training-exams.css；390×844视觉复验为清晰单列表单，输入边框、标签、按钮可见，桌面使用表格而手机使用卡片。
- MGR002真实浏览器录入EMP001考核：笔试+实操、88.5分、合格、中国时间2026-09-18 13:00，保存后表格精确显示。
- 评定选EMP001及对应技能自动回填88.5，修改为90，未上传证据保存成功为“待 HR 归档”；桌面记录与手机卡片均显示90、L2、通过、部门和日期。
- QAE-02浏览器闭环：未来日期2027-10-01被提示“评定日期不得晚于今天”，输入保留，无新记录。自动化日期fill仅改变DOM而未触发React状态曾造成误判，改用原生ArrowUp键触发输入后验证通过；不是业务代码残留问题。
- 手机390×844评定录入表单与档案卡片已视觉检查，无明显横向溢出，检查后viewport已reset。baseline另验收员工个人培训与个人考核手机入口，证据见其独立报告。

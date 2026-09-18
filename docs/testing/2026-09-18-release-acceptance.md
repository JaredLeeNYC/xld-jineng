# 2026年9月需求交付验收索引

需求来源和实施解释：[需求清单](../requirements/2026-09-18/requirements.md)、[实施安排](../requirements/2026-09-18/implementation.md)。本文件记录验收覆盖，不将开发完成等同于验收通过。

| 范围 | 需求编号 | 独立验收证据 |
|---|---|---|
| 概况、组织、岗位要求、全厂只读 | X02、X05—X08、X12—X13 | core-acceptance-round-1、organization-ui-acceptance、standards-review |
| 员工只读、多选计划、负责人实际执行 | X03、X09a—X09b、D04—D06、D11 | training-material-acceptance、spec-review、PostgreSQL HTTP 合同 |
| 资料上传、字段编辑、预览与逻辑移除 | X10—X11、D01—D03 | training-material-acceptance、PostgreSQL HTTP 合同 |
| 考核与技能评定 | X04、D07—D10 | exam-acceptance-round-1、独立考核数据库脚本 |

## 返修闭环

独立 Standards 与 Spec 审查发现的实际提交人自审批、岗位迁移竞态、新评定退回后 L0 校验、多负责人部门权限、历史证据入口和列表序号，均以各自审查报告中的复测结论为准。资料 UUID 引用边界另纳入真实 HTTP 回归。

## 发布门禁

最终代码门禁已通过：`bun test` 为 144 项通过、0 失败、478 断言；`bun run check` 的 99 个文件类型/lint、OpenAPI/部署契约、真实 PostgreSQL HTTP 合同及生产构建均通过。独立考核脚本 31/31，并发岗位验收 4/4；Standards / Spec 问题以最终复核报告为准。

尚未推送。剩余浏览器验收为多文件实际上传、组织逻辑移除、全厂只读管理账号界面。Chrome 确认对话框导致连接超时，需恢复连接；临时合成账号的全厂只读夹具变更被自动审批拒绝，已请求用户明确授权后测试并恢复。不得把未执行的浏览器项记为通过。全部报告关闭后提交推送，远端工作流成功、提交 SHA 和健康接口读回另记录发布回执。

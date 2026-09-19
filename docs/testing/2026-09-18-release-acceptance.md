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

尚未推送。2026-09-19 补验：多文件已通过真实内置浏览器提交，独立智能体验证两文件 API/数据库/下载字节与 SHA-256 一致，见 multifile-download-evidence。截图源文件的 JPEG 内容与 PNG 扩展名不匹配曾被业务校验正确拒绝，现已改为 .jpg。

X13 功能实现经独立真实 PG/HTTP 加实际组件纯内存 SSR 验证通过，见 factory-read-component-acceptance；未执行被拒绝的临时权限变更，不再需要该夹具授权。指定邓华明账号实际授权仍待部署后读回，不能用测试会话替代。

最后的组织浏览器验收已于 2026-09-19 完成：用户处理原生确认框后，岗位要求显示 0 条；主智能体实际点击岗位和部门停用，列表均显示停用。独立智能体读回确认三条记录 active=false，原 ID、关联关系及历史字段完整保留。详见 organization-ui-acceptance 最终闭环。

发布前验收已全部闭环，Standards / Spec 待修项均为 0。最新完整 `bun run check` 通过（100 个文件，零类型/lint 警告，真实 PostgreSQL/部署契约及生产构建成功）；业务代码未在 144 项 `bun test` 全通过后变更。下一步正常推送 main，核验自动部署和指定账号授权读回，完成之前不宣称目标全部完成。

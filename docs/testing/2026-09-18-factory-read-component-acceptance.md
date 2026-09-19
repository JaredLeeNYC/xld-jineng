# X13 纯组件补充验收与证据充分性评估

本次严格使用合成内存 props/state。没有更改 MGR002 或任何账号，没有数据库连接、权限写入、授权脚本执行或浏览器操作。SSR 探针将 fetch 设置为抛错，实际网络调用为 0；因此不存在通过替代测试绕过被拒绝的账号授权。

## 本次独立执行

临时探针实际导入 `apps/web/src/app.tsx` 的 App，用 `initialSession` 构造 department_manager 会话，并仅在内存注入当前导航及两个合成部门的岗位要求数据。执行 SSR 三场景全部通过：

1. factoryRead=false：主导航不出现新增“技能标准”入口。
2. factoryRead=true：实际 App 主导航出现“技能标准”；将内存导航设为 requirements 后，实际 RequirementsView 渲染本部门及其他部门的岗位要求，桌面 table 与手机 cards 均有数据。
3. 内存筛选设为其他部门：table/cards 只显示该部门行。岗位要求 section 没有 button 或 form，显示“修改由 HR 维护”。这是组件状态渲染测试，不是浏览器点击筛选或视觉测试。

结果：`docs/testing/2026-09-18-evidence/factory-read-ssr.json`；探针：`.scratch/requirements-20260918/factory-read-ssr.ts`。正式业务代码无改动。

## 与已存在独立证据结合

此前本审查者实际运行成功的完整 PostgreSQL 合同已验证：factoryRead 主管可读其他部门及员工档案，但组织写入 403、跨部门培训计划写入 409；指定姓名授权函数对不存在/同名拒绝、唯一有效账号授予、重复幂等、保留 department_manager 角色、单次审计全部通过。本轮没有重新执行这些权限变更用例，仅引用已存在的独立执行证据。

另外审读当前接口入口及 skill-service.ts:158—163：岗位要求读取接受 factoryRead 并调用完整列表查询，前端 RequirementsView 使用同一 `/api/position-skill-requirements` 入口。写路径仍由既有角色检查负责，SSR 不能替代服务端鉴权。

## 判断

**足以关闭 X13 的功能实现验收**：权限模型、指定姓名授权函数、跨部门只读不扩大写入已由真实 PG/HTTP 证据覆盖；此前缺少的 App 导航与只读岗位要求显示，现有实际组件 SSR 独立证据补足。证据类型必须标为“PG/HTTP + 组件 SSR”，不能标成 factoryRead 浏览器验收通过。

**不能据此宣称 X13 在目标环境已经交付到指定账号，或浏览器专项已通过。** 仍需主发布验收读回目标环境唯一邓华明账号的实际授权结果及角色保持；SSR 合成会话不能证明该真实账号存在或已经得到授权。若项目把 X13 关闭定义为包含部署后账号验收，应保留“发布读回待验”，不能仅靠本报告关闭整项。被自动审批拒绝的临时 MGR002 授权本轮保持未执行。

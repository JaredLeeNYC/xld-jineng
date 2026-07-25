# 技能矩阵系统开发约束

- 产品语言以 `CONTEXT.md` 为准，界面文案使用简体中文，代码标识符使用英文。
- `packages/db` 拥有 PostgreSQL、Drizzle schema 与迁移。
- `packages/shared` 拥有纯契约、枚举和校验器。
- `apps/server` 拥有 HTTP 协议与业务工作流。
- `apps/web` 拥有响应式员工端与管理端。
- API 返回 `{ ok: true, data }` 或 `{ ok: false, error }`。
- service 拥有业务规则，route 只负责鉴权、输入和 HTTP 映射。
- 使用 Bun；`bun run check` 是交付门禁，`bun test` 是行为验证入口。
- 列表必须具备 loading、error、empty 状态，桌面使用表格，手机使用卡片。
- 正式业务记录不可物理删除，基础数据只允许停用。

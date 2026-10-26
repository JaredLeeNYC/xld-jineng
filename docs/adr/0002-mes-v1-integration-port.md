# MES v1 集成边界

一期不运行 MES 同步任务，也不提供空白同步页面。代码只在 `packages/shared/src/mes-v1.ts` 预留版本化 port，未来适配 `D:\dev\better` 或其他 MES 时不侵入现有 HTTP route 与业务 service。

约束如下：

- `employeeNumber`、`departmentCode`、`positionCode` 是稳定业务键，不接受外部数据库主键。
- 每个外部事件必须携带全局唯一 `eventId` 和 `occurredAt`；适配器持久化幂等结果后才能返回 `applied`。
- 接入前逐字段确定主数据所有权。不得让本系统和 MES 对同一字段做无规则双向覆盖。
- MES 适配器只调用现有组织 service/内部 command；不得直接写 Drizzle 表、跳过停用规则或删除正式记录。
- 新协议使用 `mes.v2` 等新命名空间演进，不在既有 `mes.v1` 载荷上做破坏性修改。
- 认证、重放窗口、失败队列和监控属于二期实施内容，必须在真实 MES 接入时完成威胁建模和合同测试。


## MES 读取技能矩阵（已实现）

MES 系统集成中心只读拉取技能矩阵，做法与 TPM 给 MES 的同步接口相同：

- `GET /api/mes/v1/skill-matrix`，请求头 `Authorization: Bearer <MES_SYNC_API_KEY>`，返回 `{ ok: true, data: SkillMatrixCell[] }`：全厂在岗员工 × 当前岗位每项有效技能要求，字段与 `/api/skill-matrix` 相同，不按账号收窄。
- `MES_SYNC_API_KEY` 配在 `server.env`，MES 侧 `MES_SKILLS_API_KEY` 用同一个值；未配置或短于 32 位时接口返回 503，key 不对返回 401。只读，不写业务数据。
- 轮换：先换本系统并重启，再换 MES；两次之间 MES 拉取记 401 失败。

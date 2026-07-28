# MES v1 集成边界

一期不运行 MES 同步任务，也不提供空白同步页面。代码只在 `packages/shared/src/mes-v1.ts` 预留版本化 port，未来适配 `D:\dev\better` 或其他 MES 时不侵入现有 HTTP route 与业务 service。

约束如下：

- `employeeNumber`、`departmentCode`、`positionCode` 是稳定业务键，不接受外部数据库主键。
- 每个外部事件必须携带全局唯一 `eventId` 和 `occurredAt`；适配器持久化幂等结果后才能返回 `applied`。
- 接入前逐字段确定主数据所有权。不得让本系统和 MES 对同一字段做无规则双向覆盖。
- MES 适配器只调用现有组织 service/内部 command；不得直接写 Drizzle 表、跳过停用规则或删除正式记录。
- 新协议使用 `mes.v2` 等新命名空间演进，不在既有 `mes.v1` 载荷上做破坏性修改。
- 认证、重放窗口、失败队列和监控属于二期实施内容，必须在真实 MES 接入时完成威胁建模和合同测试。


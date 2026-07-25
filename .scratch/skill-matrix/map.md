# 技能矩阵系统一期决策地图

## Destination

形成一份可直接拆分为纵向实施票据的技能矩阵系统一期规格，明确领域模型、复用架构、核心流程、界面范围、集成边界和上线验收标准。

## Notes

- 产品原则：满足工厂实际管理需求，优先简单、可用、可追溯。
- 技术原则：沿用 `D:\dev\lzb-iot` 架构和云端部署方式。
- 工作流：地图清晰后进入 `/to-spec`，再进入 `/to-tickets` 和逐票 `/implement`。
- 领域语言以仓库根目录 `CONTEXT.md` 为准。

## Decisions so far

- [确定技能矩阵系统一期产品边界](decisions/01-confirm-phase-one-product-boundary.md) - 一期聚焦单工厂员工培训、技能评定和矩阵更新闭环，员工可独立使用响应式 Web。
- [提炼 lzb-iot 可复用技术架构](decisions/02-extract-reusable-lzb-iot-architecture.md) - 复用 Bun/Elysia/React/PostgreSQL/Drizzle、OpenAPI、响应式列表与云发布护栏，排除全部 IoT 专属运行时，并新增对象存储适配器和版本化集成边界。
- [将需求材料压缩为一期领域模型](decisions/03-compress-requirements-into-domain-model.md) - 一期由 16 个最小实体、固定培训与评定状态机、16 条业务不变量、五类角色、19 个核心页面和 10 个验收场景构成。
- [汇总可实施规格边界](decisions/04-synthesize-buildable-spec-boundary.md) - 一期采用模块化单体 Web 架构，以八个可演示纵向切片覆盖组织技能、培训、评定、矩阵、通知、报表和上线闭环。

## Not yet specified

地图已清晰：没有未解决票据或无法精确定义的在途问题，可以交给 `/to-spec`。

## Out of scope

- 在线考试、题库、组卷、自动阅卷和防作弊。
- 原生 APP、企业微信小程序和扫码签到。
- SSO、企业微信身份认证、短信及邮箱找回。
- 自定义角色设计器、可配置审批流和自定义报表。
- 多工厂、多租户和集团汇总；其他工厂采用独立部署。
- 一期直接对接 HR、ERP、MES 或 PPS。

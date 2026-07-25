# 提炼 lzb-iot 可复用技术架构

Type: research
Status: resolved
Blocked by:

## Question

技能矩阵系统应从 `D:\dev\lzb-iot` 原样复用哪些工程、运行、部署和验证模式，哪些 IoT 专属模块应明确排除？

## Answer

一期沿用 `lzb-iot` 的 Bun workspace、React/Elysia/PostgreSQL/Drizzle、响应式 UI、OpenAPI、测试与显式云端发布护栏，认证、附件和 MES 边界按技能矩阵领域适配，MQTT/EMQX/ingester/遥测等 IoT 模块明确排除；详见 [研究报告](D:/dev/jineng/.scratch/skill-matrix/research/lzb-iot-reusable-architecture.md)。

# 部署返修独立验收第三轮（2026-09-08）

范围：首次远端发布的假成功故障与部署入口修复。此前本地业务功能验收结果不变，本轮不重复修改或验收业务实现。

## D1：工作流显示成功但发布脚本提前结束

- 严重度：高，阻断“已部署”验收。
- 远端证据：GitHub run `34205864031` 显示success，日志终止于数据库备份完成；无迁移、current切换、健康检查、四工号变更及精确SHA读回。
- 公网主代理读回仍为旧资源 `index-2Nrwkr-V.js` / `index-trIgt1YB.css`，候选资源为 `index-BqAyK7yW.js` / `index-DUycSXhB.css`。首次只完成安装LibreOffice、构建和数据库备份，不视为上线。
- 独立复现：将多行脚本交给 `bash -s`，脚本中的子进程读取stdin后吞掉后续命令，输出只有 `backup_started`，退出码仍为0；同一脚本改为文件执行且stdin连接 `/dev/null`，正常输出迁移、切换和账号验证标记。
- 机制与生产调用对应：原工作流 `git show ... | bash -s ...` 把脚本放在stdin；`docker compose exec -T` 继承该stdin。之前部署mock没有模拟子进程读取stdin，这是验收覆盖缺口，现已补上。
- [独立stdin复现证据](2026-09-08-deploy-stdin-evidence.json)。

## 修复复测

实际抽取最终 `.github/workflows/deploy.yml` 的远端script段执行，git返回隔离候选脚本，路径改为本地测试目录；不连接生产、不写远端。

| 场景 | 预期 | 独立执行结果 |
|---|---|---|
| 正常脚本含读取stdin子进程 | 后续迁移、切换、四账号验证和SHA读回都执行 | 退出0，通过 |
| `.deployed-sha` 缺失 | 不得报告部署成功 | 退出1，通过 |
| `.deployed-sha` 与候选不符 | 不得报告部署成功 | 退出1，通过 |
| 缺精确SHA账号完成marker | 不得报告部署成功 | 退出1，通过 |
| 缺4243工号结果 | 不得报告部署成功 | 退出1，通过 |
| 子部署脚本退出7 | 失败经tee管道传播 | 退出7，通过 |

[最终工作流六场景证据](2026-09-08-workflow-readback-evidence.json)。测试直接执行最终工作流逻辑，不是仅检查字符串。

静态复核：候选脚本保存到随机临时文件；执行stdin明确为 `/dev/null`；trap清理临时脚本和日志；`set -euo pipefail` 保留失败；四账号脚本成功后才输出精确SHA marker并写部署SHA；外层要求磁盘SHA与marker及四工号同时存在。

## 最终门禁与结论

独立 `bun run check` 退出0：类型/lint、OpenAPI与部署契约、真实PostgreSQL合同、前端生产构建均通过。独立 `bun test` 129 pass、0 fail、425断言、31文件，14.36秒。

**部署修复本地验收通过，可提交并再次推送部署。** 远端下一次发布尚未验收，必须继续检查迁移、切换、health/ready、四账号结果和精确SHA，不能以工作流绿色单独宣布上线。

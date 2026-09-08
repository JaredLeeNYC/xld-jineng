# 2026-09-08 部署第三轮修复：标准输入导致的假成功

## 真实失败证据

- GitHub Actions run：34205864031，提交 a8f954e330349652967fb79c63b17722f4dc46a1。
- 本地已下载原日志：`.tmp/deploy-34205864031.log`（未提交原始运行日志）。
- 2026-09-08 08:46:32.2608879 UTC：输出 `==> backing up database`。
- 08:46:32.7843431 UTC：输出数据库备份成功并已校验，备份文件为 `/var/backups/skill-matrix/pre-a8f954e33034-20260908164632.dump`。
- 08:46:32.7938599 UTC：SSH action 输出 `Successfully executed commands to all hosts`，任务 conclusion=success。
- 日志缺少后续 db:migrate、current 切换、health/ready 回读及四工号账号处理输出。因此 GitHub success 不能证明部署完成。远端实际读回由主代理执行确认。

## 根因与复现

旧 workflow 将 `git show SHA:deploy/auto-deploy.sh` 管道接入 `bash -s`。脚本源码与子进程共享 stdin；数据库备份调用的 `docker compose exec -T` 可消费尚未被 Bash 解释的脚本余下内容。Bash 到达 EOF 后返回 0，SSH action 因此误报成功。

持久化回归测试用真实 Bash 运行 `echo backup; cat >/dev/null; echo deployment-complete` 的逐行 stdin 脚本，确认返回码为 0 且末尾标识未执行，复现同类故障机制。

## 修复

- 精确 SHA 的脚本先写入 mktemp 文件，再 `bash 文件 SHA </dev/null` 执行，子进程不再接触脚本源码。
- 输出通过 tee 留在受控临时日志，pipefail 保留部署脚本失败状态；EXIT trap 清理脚本及日志。
- 脚本必须成功执行四工号升级/读回流程，才输出包含完整 SHA 的账号验收标识；随后写入 `.deployed-sha`。
- workflow 强校验 current/.deployed-sha 等于触发提交，检查完整 SHA 的账号成功标识及 0341/10032/3761/4243 四项处理日志，最后才输出部署读回成功。
- 原候选 release 目录保留；发布修复使用新提交对应的新 release 目录，不覆盖首次候选。

## 自动回归

`apps/server/src/deployment-workflow.test.ts` 实际提取并执行 workflow SSH 脚本，替换仅 Git 取文件和隔离目录路径；验证：旧stdin问题复现、修复后子进程消费stdin仍完整执行、错误SHA拒绝、缺账号完成标识拒绝、部署子进程非零拒绝、缺四工号日志拒绝；并验证各场景临时文件清理。

开发定向测试：6 pass / 0 fail / 20 assertions。最终由独立 QA 复验后再 push；本文不宣称修复版已成功部署。

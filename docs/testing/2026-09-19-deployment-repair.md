# 发布传输故障与修复

需求版本 `2fae7937f1b0c20efd78b68e72be7eec5ade3d1e` 已正常推送。部署运行 35414777959 两次均在服务器 `git fetch origin` 阶段失败：第一次 SSL connection timeout，第二次 Failure when receiving data from the peer。两次均未进入数据库迁移或版本切换。

修复由 training_dev 实施：GitHub Actions 检出精确提交、生成完整 Git bundle，通过既有 SSH 凭据传至每次运行独立的临时目录。服务器验证 bundle、导入并核对 FETCH_HEAD，随后仍从预期 SHA 读取发布脚本。移除服务器再次拉取 main 的步骤，保留备份、迁移、原子切换、健康检查、指定账号授权及部署 SHA 读回。未关闭证书验证或扩大权限。

root 已执行原发布结果核验回归 7/7，通过错误 SHA、缺少账号/全厂读取标识、子脚本失败和清理检查。真实 Git bundle 的独立测试由 standards_review 执行；完整门禁及新部署结果以最终记录为准。

## 独立 Git bundle 验收

Standards 审查智能体独立新增 `apps/server/src/deployment-bundle.test.ts`，直接提取当前 workflow 的 `Create complete release bundle` run 块及 `Deploy via SSH` script（截至生产读回检查前），执行真实 bundle 生成、verify、fetch、SHA 校验、git show 与 bash 调用。测试仅将临时 Git 提交内的部署脚本替换为记录调用 SHA 的 fixture，未 mock Git 或重写生产 gate。目标仓库从空仓库开始，无 origin，无线上访问。

`bun test apps/server/src/deployment-bundle.test.ts`：**6 pass / 0 fail，20 assertions**。

- 完整 bundle：空目标仓库成功导入精确 SHA，父提交存在，发布文件正确，且部署 fixture 收到该 SHA。
- 错误预期 SHA：即使 bundle 有效且包含该历史提交，FETCH_HEAD 不匹配仍拒绝，不调用部署。
- 损坏 bundle：verify 拒绝，不调用部署。
- 缺少 `refs/deploy/release`：fetch 拒绝，不调用部署。
- 增量 bundle 缺少目标库所需 prerequisite 提交：verify 拒绝，不调用部署。
- runner checkout 与 EXPECTED_SHA 不同：生成阶段拒绝，不产生 bundle。

定向 `vp check --no-fmt apps/server/src/deployment-bundle.test.ts` 通过，无类型/lint问题。初次测试暴露的是 Windows 原生 Git 的测试夹具路径格式问题（误传 Git Bash `/c/...` 路径），已改为原生路径并最终全部通过，不涉及生产 Linux 路径变更。临时仓库均清理。

独立审读确认服务器脚本已移除 `fetch origin main`，保留 checkout 后 FULL_SHA 精确校验；备份、迁移、切换及读回部分没有修改。本次独立验收不冒充 SCP/SSH 真实云端运行结果，线上传输与最终读回由随后的 Actions 发布验证。

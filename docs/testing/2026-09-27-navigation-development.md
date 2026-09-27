# 2026-09-27 岗位要求与矩阵入口开发验证

对应源表第2、3、9行。

## 复现

命令：`bun test apps/web/src/september-requirements.test.tsx`

修复前：0 pass / 2 fail。HR 导航查找 matrix 返回 undefined；实际矩阵组件输出的等级图例无 `matrix-level-blocks`。

候选原因：角色导航配置遗漏、图例 JSX 缺项、角色过滤或 CSS 隐藏。实际 SSR 与导航函数证据证明前两项，后两项不是本次根因。

## 修复

- HR 导航加入独立「技能矩阵」入口，使用原有矩阵服务端授权。
- L0–L4 图例补齐 2×2 方格，绿色填充数分别为 0–4，复用矩阵图示结构。
- HR「当前岗位要求」标题旁增加独立部门筛选，筛选不受上方技能目录条件影响；筛选数量与空状态相符。
- 全厂读取页面已有部门/岗位联动筛选，补充结果计数与明确的可访问筛选名称。

## 回归

`bun test apps/web/src/app.test.tsx apps/web/src/september-requirements.test.tsx packages/shared/src/authorization.test.ts`：17 pass / 0 fail，72 assertions。

没有临时调试日志。交互、窄屏及网络层验证交独立验收智能体执行；本报告不替代端到端验收。

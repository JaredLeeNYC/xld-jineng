# Issue tracker: Local Markdown

本项目的规格、决策地图和实施票据保存在仓库 `.scratch/` 目录。

## Conventions

- 每个特性一个目录：`.scratch/<feature-slug>/`
- 规格：`.scratch/<feature-slug>/spec.md`
- 实施票据：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 票据使用 `Type:`、`Status:` 和 `Blocked by:` 表达类型、状态和依赖
- Wayfinder 地图：`.scratch/<effort>/map.md`
- 研究材料：`.scratch/<effort>/research/`

## Wayfinding operations

- Frontier：状态为 `open`、没有未解决 blocker、且未被 claim 的最小编号票据
- Claim：开始工作前将 `Status:` 改为 `claimed`
- Resolve：写入 `## Answer`，将状态改为 `resolved`，并把一句摘要链接加入地图的 `Decisions so far`

---
kind: upgrade-guide
description: "实验性策略目录增加结构化成本数据，载体依赖 TokenMeter。"
---

# 任务策略成本目录

[English](guide.md) | 中文

## 变更

`StrategyRegistry.list`、`ctx.taskStrategies.list` 和 `catalog` 的策略条目现在要求提供 `cost` 数据。估算包含已知输入与子任务数、可选显式场景总量，以及不确定项。载体在已有服务之外依赖原版 `tokenMeter`。自动选择获得任务成本数据。已有策略配置无需增加 `tokenCost` 也可继续使用。

## 迁移

1. 手动组合载体时挂载 `@deepseek-ai/dsh-token-meter`。标准 base bundle 已提供该服务；自定义 Loader fixture 需补上。
2. 更新目录生产者及精确形状测试，加入 `cost`。未提供声明式估算数据的不透明作者决策使用 `{ kind: 'unknown', reason: 'dynamic-plan' }`。消费者不能把未知成本解释为零。
3. 注册静态作者策略时可提供 `cost: { plan, variants?, assumptions? }`。独立注册表在 `new StrategyRegistry(measure)` 中接收所属系统的文本估算器；未提供时成本保持未知。
4. 在声明式策略中可配置 `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }`。这些是场景假设，与执行限制分开。`task_strategy_list` 可带 `task` 和 `preferences`，偏好参数要求原始任务。确认返回的 `basis` 为 `task`，且匹配变体的任务数符合预期。插件页展示不含任务正文的注册估算。

参见[估算契约](../../../../packages/experimental/task-strategy/README.zh.md#token-estimates)。

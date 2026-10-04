# 任务策略

[English](task-strategy.md) | 中文

实验性的 task-strategy 库将作者的工作流决策与 DSH 插件身份分开。它的可选 Cordis 载体仅通过显式 profile patch 加载。启用后，`ctx.taskStrategies` 会校验有序计划，并通过 DSH 现有的 preset、subagent 和 Jobs 服务分发各个下层任务；下层 agent 不会获得策略控制工具。

阶段按顺序执行，同一阶段内的任务可以并发。分发前会检查预设与工具过滤器，进度记入 DSH 自有 job；卸载载体时会取消并等待其活动子任务清理完成。并发任务仍可能共享文件，因此作者需要协调写入。任务轮次结束仅表示子任务已结束，不代表其输出经过独立验证。

## 服务 API

根包会导出 `TaskStrategies` 类型和 `ctx.taskStrategies` 类型扩展。其方法由可选的 `./cordis` 载体实现：

- `list()` 和 `catalog()` 枚举作者策略及允许使用的预设，不执行策略决策。
- `register(strategy)` 在调用方 Cordis 生命周期内注册作者决策。
- `decide(id, input)` 返回与输入隔离的计划，并先验证预设和下层能力。
- `start(parent, task, plan, signal)` 创建原版 DSH Job，再通过配置的原版 DSH subagent provider 分发各步骤。

根库可提供 API 类型，但在显式加载载体前，运行时服务和工具都不会出现。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->
<!-- END GENERATED cordis-surface -->

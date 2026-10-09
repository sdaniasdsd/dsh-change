---
kind: upgrade-guide
description: "task-strategy 作者决策和策略替换回调要求同步返回计划数据。"
---

# 同步任务策略决策

[English](guide.md) | 中文

## 变更

公开的实验性 task-strategy 包要求 `AuthorStrategy.decide(input): ExecutionPlan` 和 `TaskRun.requestSwitch(load, { expectedBindingEpoch })` 回调同步返回计划或 `CapturedStrategy`。此前两者接受异步决策。`StrategyRegistry.decide` 现在直接返回 `ExecutionPlan`，作者错误和策略查找错误同步抛出。自定义作者策略及直接使用代码库的调用方需要迁移，配置式静态计划保留原有行为。Cordis 载体的 `ctx.taskStrategies.decide` 仍通过 Promise 执行异步准入检查。

## 迁移

1. 在自定义策略模块中移除 `AuthorStrategy.decide` 的 `async`，通过可信且有限的计算返回普通 `ExecutionPlan`。将模型调用、工具及其他异步 I/O 移到子任务或支持取消的 `TaskExecutor`。
2. 直接调用 `StrategyRegistry.decide` 的代码若使用 `.then` 或 `.catch`，改为读取返回计划并处理同步异常。原有 `await` 调用可以改为直接调用。
3. 直接调用 `TaskRun.requestSwitch` 时，同步返回 `captureStrategy(id, plan)`，并传入做出切换决定时读取的绑定版本；运行时在返回命令前捕获数据。异步能力准入仍放在 `TaskRunOptions.prepare` 中。版本与游标参数见[受校验的控制命令](../task-strategy-binding-commands/guide.zh.md)。
4. 编译策略调用方，执行一次阶段边界替换，并取消一个正在执行的已接收任务。确认 JobId 保持相同，所属 Agent 的销毁在子任务清理后结束。具体语义见[包文档](../../../../packages/experimental/task-strategy/README.zh.md)。

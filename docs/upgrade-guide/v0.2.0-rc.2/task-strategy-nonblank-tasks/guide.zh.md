---
kind: upgrade-guide
description: "实验性任务策略决策与执行拒绝空白任务正文。"
---

# 任务策略需要非空正文

[English](guide.md) | 中文

## 变更

公开的实验性任务策略包会拒绝空字符串或纯空白任务，错误为 `Task must not be empty`。此规则适用于 `StrategyRegistry.decide`、`TaskRun` 构造、`executePlan`，以及可选 Cordis 载体的决策、提交和分发入口，包括模型工具。此前空白任务可以创建 Job 并启动子任务。拒绝发生在调用作者函数或准入子任务之前，已接收任务文本保留原有空白。

## 迁移

1. 调用这些 API 或工具时，提供至少包含一个非空白字符的任务正文。预览或分发前，将空白占位值替换为实际任务。
2. 处理注册表决策与 `TaskRun` 构造同步抛出的异常，以及异步执行与载体 API 的 Promise 拒绝。模型工具返回错误且不创建 Job；修正正文后可以重试。
3. 分别运行一项有效任务与一项纯空白任务，确认后者不会创建 Job 或子任务。参见[包契约](../../../../packages/experimental/task-strategy/README.zh.md)。

---
description: "独立于 DSH 插件的作者工作流策略，以及可显式接入的 Cordis 载体。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-task-strategy

[English](README.md) | 中文

## 概述

作者可以编写命名策略，决定任务阶段、子任务插件预设、工具限制及模型路由。主入口是普通代码库：策略身份不进入 DSH 插件注册表。可选的 `./cordis` 载体沿用其他服务的 Cordis 接入方式，通过原版 DSH 子任务和自有 Jobs 执行。默认产品组合保持不变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 独立的作者决策

从主入口导入 `StrategyRegistry` 和 `executePlan`。注册 `{ id, description, decide(input) }`；决策接收 `{ task, preferences }` 并返回 `ExecutionPlan`。`register` 返回注销函数，重名会拒绝。决策及输入均是独立快照。计划包含顺序阶段，同一阶段内的任务按 `maxConcurrent` 并发。每个任务指定 `label`、`preset`、`instruction`，可附加 `tools: { allow, deny }`、`model`、`provider`。纯执行器接收你提供的支持取消的 `TaskExecutor`；该回调必须在资源释放之后结算。

### DSH 源码试用

在仓库根目录使用受支持的命名 profile 启动入口：

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

修改 [cordis.source.patch.yml](cordis.source.patch.yml) 编写自己的策略偏好和流程。`direct` 使用一个原版 DSH 子任务。`cautious` 并发运行两个只能读取、搜索的子任务，然后运行一个实现子任务；`preferences: { speed: "fast" }` 切换为短流程。`allowedPresets` 明确允许可选择的原版 DSH 插件预设。选择预设不会授予文件系统或审批权限。省略工具过滤器会保留预设工具，显式空白名单则不暴露任何工具。

独立载体提供 `ctx.taskStrategies`：`register`、`list`、`catalog`、`decide`、`start`。它注入原版 `agents`、`tools`、`subagents`、`agentPresets` 和 `jobs`。作者可以在调用方 Cordis 生命周期内注册 JavaScript 决策函数，也可以通过载体配置声明按偏好选择的计划。根 Agent 获得 `task_strategy_list`、`task_strategy_plan`、`task_strategy_run`，下层子任务不会继承这三个控制工具。上层可以选择命名策略或提交显式计划，但只能选择允许的预设。使用原版 `job_list`、`job_output`、`job_kill` 查看或取消；进度包含阶段名与已完成子任务的会话身份。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

注册表只做决策，不加载插件。执行器实施阶段屏障、并发限制、任务数及结果字节上限，将标注的前阶段输出作为数据传递。载体在创建 Job 前检查提供方能力与预设可用性。原版 DSH 进程内驱动在子任务发布前挂载选定预设；权限委托、模型循环、结算及回收仍走原版。一项子任务失败会停止准入并取消兄弟任务，当前阶段排空之后才终止。载体卸载会取消并排空活动运行。原有子系统不变量负责 Agent、子任务、预设、工具、Job 所有权，本代码库没有独立注册的不变量。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 独立作者策略注册表 |
| [src/types.ts](src/types.ts) | 计划与执行器契约 |
| [src/executor.ts](src/executor.ts) | 顺序阶段与有界并发 |
| [src/cordis.ts](src/cordis.ts) | 可选的原版 DSH 接入载体 |
| [src/tools.ts](src/tools.ts) | 上层决策和分发工具 |
| [src/schema.ts](src/schema.ts) | 配置与不可信 JSON 校验 |
| [tests/adapter.spec.ts](tests/adapter.spec.ts) | 真实 Loader 组合及免密钥模型循环记录 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [子任务契约](../../subagent/subagent/README.zh.md)
- [预设注册表](../../preset/agent-preset-registry/README.zh.md)
- [本地 Jobs](../../jobs/jobs-local/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 上层决策工具与下层任务输入

#### 模型看到什么

可选载体通过 `task_strategy_list` 列出策略描述与允许的预设名，通过 `task_strategy_plan` 预览 JSON 执行计划，通过 `task_strategy_run` 分发并返回原版 Job id。下层接收用户任务、选定指令及标注的前阶段文本结果。Job 输出暴露进度与终态报告。主注册表本身不添加提示词段落或工具。

#### Token 影响

只有根 Agent 支付三个决策工具的 schema 成本。每个子任务支付选定预设及累积前阶段数据的成本。结果和输出字节上限约束保留文本；截断文本带有明确提示，不保证仍是合法 JSON。

#### KV Cache 影响

上层工具结果追加到历史。每个子任务有自己的请求前缀；预设、过滤器、路由选择可能改变前缀。不承诺复用父级缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 并发限制针对单次运行，不是多个 Job 的全局配额。工作流是顺序阶段，不是任意 DAG 或持久队列。
- 子任务共享工作文件。工具过滤不是文件系统隔离；并发写入需要作者安排安全流程。
- 没有自动重试、暂停恢复或崩溃恢复。`completed` 表示原版模型轮次完成，不代表独立验证正确性。
- 报告只保留文本输出。超过结果字节上限会停止流程；过大的展示文本会明确截断。
- 本功能为实验性显式接入。真实模型执行需要可用的已配置提供方；测试使用免密钥的脚本模型适配器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

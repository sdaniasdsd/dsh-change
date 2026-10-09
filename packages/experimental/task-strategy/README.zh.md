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

<a id="token-estimates"></a>
### 可解释的 Token 估算

`list()` 返回每条策略的 `cost`；`list({ task, preferences })` 按任务和匹配的偏好变体细化估算，不调用 `decide`。载体复用 DSH 的 TokenMeter，并依赖该服务。独立注册表通过构造函数接收文本估算器；缺少估算器或动态策略未声明估算计划时，成本显示未知。

声明式策略可设置 `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }`。所有值必须为安全整数，调用数为正，上下文与输出可为零。这些显式场景假设估算重复输入、生成输出及向后续阶段的传递，不限制执行。未配置假设时，目录只报告已知任务/指令/结果结构输入及任务/阶段数，不提供总量。会话标识、JSON 转义、实际历史、推理、分词与缓存影响仍不确定。不计入父任务和选择器用量。

使用 `task_strategy_list({ task, preferences? })` 向模型提供估算。自动选择获得同一份任务估算数据，先满足任务要求，再比较成本。原版插件页展示注册成本、假设和未知项。注册估算不含任务正文；这是近似值，不是账单用量或保证的边界。

[可选工作流配置](../../../strategies/workflows.patch.yml) 为编程、论文调研、问题研究和方案规划提供三档策略，数值都是可编辑的场景假设。参见[配置与档位选择](../../../strategies/README.zh.md#workflow-library)。

### 独立的作者决策

任务正文必须包含非空白字符。决策、预览与分发在调用作者函数或准入子任务之前拒绝空白任务，已接收文本保留原有空白。

`AuthorStrategy.decide` 和 `StrategyRegistry.decide` 同步返回 `ExecutionPlan`；作者错误同步抛出。策略函数必须是可信、有限且不执行 I/O 的计划计算。异步调研、模型调用与工具执行交给支持取消的执行层。载体的 `ctx.taskStrategies.decide` 仍返回 Promise，因为它还执行异步准入检查。旧作者接口的迁移步骤见[同步决策升级说明](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-synchronous-decisions/guide.zh.md)。

从主入口导入 `StrategyRegistry` 和 `executePlan`。注册 `{ id, description, decide(input) }`；决策接收 `{ task, preferences }` 并返回 `ExecutionPlan`。`register` 返回注销函数，重名会拒绝。决策及输入均是独立快照。计划包含顺序阶段，同一阶段内的任务按 `maxConcurrent` 并发。每个任务指定 `label`、`preset`、`instruction`，可附加 `tools: { allow, deny }`、`model`、`provider`。纯执行器接收你提供的支持取消的 `TaskExecutor`；该回调必须在资源释放之后结算。

### 由任务持有的策略替换

`TaskRun` 和 `captureStrategy` 提供执行已捕获静态计划的普通代码库运行时。替换策略后，任务输入、结果、累计子任务准入数和结果字节上限继续保留。`requestSwitch(load, { expectedBindingEpoch, startStage })` 立即预留命令并同步捕获目标计划，当前阶段排空之后才准入并提交新绑定。目标游标是显式的零基下标，默认从零开始。切换被拒绝时进入 `waiting` 并保留旧绑定；`resume(expectedBindingEpoch)` 继续旧绑定，也可以再次切换到其他目标。两种命令都必须携带通过 `inspect()` 观察到的非负安全整数 `binding.epoch`；版本过期会在作者函数执行或状态改变前拒绝。`cancel(reason)` 立即取消活跃执行，在资源回收后结算。`load` 必须同步返回捕获的计划；异步工作归执行层管理。

载体提供宿主方法 `submit(parent, request, signal)`、`inspect(parent, jobId)`、`requestSwitch(parent, jobId, request)` 和 `resume(parent, jobId, expectedBindingEpoch)`。`submit` 要求 `{ requestId, strategy, task, preferences? }`：同一活跃 Agent 的相同请求共享一次准入和回执，同一 id 携带不同内容会拒绝。准入失败会释放预留。第一个提交者的信号控制准入取消，后续重复调用不会取消已接收任务。等待和取消继续使用原版 Jobs 操作。切换请求要求 `{ strategy, expectedBindingEpoch, preferences?, startStage? }`，其中版本来自做出选择时读取的视图。`requestSwitch` 返回预留命令编号，通过 `inspect` 或 Job 日志读取已提交绑定。版本不匹配后，应重新检查任务并明确重新决定命令。这些宿主控制接口不添加模型工具或输入路由。

载体重载后，已接收任务继续使用捕获的部署规则，新载体可以通过同一个活跃 Agent 和 Jobs 服务控制这些任务。切换从当前注册表捕获新选定的计划，再按任务保留的规则准入。因此，如果原任务没有授权某个预设，新配置即使允许了它，也需要创建新任务才能使用。本切片使用原版 JobId 作为任务身份。

### 自动入口与可选选择

使用 `submitTask(parent, { requestId, task, selection?, preferences? }, signal)`。省略 selection 捕获插件当前默认值；`{ kind: 'auto' }` 从注册候选中选择；`{ kind: 'named', strategy }` 跳过选择器。回执包含 `{ jobId, name, strategy }`。相同重复请求共享预留的 Promise，冲突输入拒绝，失败入口释放标识。

工具回执保留完整 Job 与策略标识，只缩短过长的显示名称。入口在接受 Job 前，将 JSON 编码的策略标识限制为载体 `maxOutputBytes` 减去 256 字节的原版 Jobs 元数据预算，避免长标识在最低 512 字节上限下破坏回执。

如果重新挂载后调小上限，导致旧回执标识无法完整容纳，重复工具调用会明确报告 Job 已接收并给出其 id。使用 `job_output`，或恢复此前的上限再重复原请求。宿主完整回执和请求预留继续保留，任务不会再次执行。

自动选择使用原版子 Agent，仅提供其本地 `structured_output` 工具，输入包括未改写的任务数据、偏好和捕获的候选描述。默认截止时间为 30,000 毫秒，提示词上限 32,768 字节、结果上限 2,048 字节、输出上限 512 token。无效捕获、超时、取消或所选策略被移除，会在创建执行 Job 前拒绝。先清理选择器，再接受任务。作者决策保持同步。指定入口跳过选择器成本。

可选提问在 `task_strategy_submit` 之前使用原版限时 `ask_user_question`。没有答复时，仍按配置默认值执行。迟到答复不创建新标识或重复原始任务；已接受任务通过现有宿主控制在阶段边界切换。普通聊天通过原有模型循环使用按需启用的工具；插件不拦截每条消息。

Web 部分在原版插件页注册**任务策略**，通过草稿表单和带版本检查的写入，编辑默认模式/名称、模型/provider 路由及截止时间。字节和 token 限制保留在 Loader 配置中。实时 `Volatile` 引用影响未来入口；已接受 Job 保留捕获的规则。目录读取丢弃重连/卸载后的旧响应，刷新失败保留已显示的条目。生成的 Remote 只暴露 `catalog`。参见[选择升级指南](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.zh.md)。

### DSH 源码试用

在仓库根目录使用受支持的命名 profile 启动入口：

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

原版 ConfigEditor 会拒绝被命令行覆盖层覆盖的保存，页面保留草稿并报告失败。需要可编辑的插件默认值时，将覆盖文件的 insert 行复制到活跃的 `<DSH_HOME>/profiles/web/cordis.patch.yml`，将载体的相对名称改为源码的绝对 file URL（通过 Node 的 `pathToFileURL` 获得），或已安装的 `@deepseek-ai/dsh-experimental-task-strategy/cordis` 导出入口；启动该 profile 时省略策略 `--patch`。配置持久化随后由 profile 补丁负责。使用 file URL 是因为原编辑器预览与 profile 加载对本地路径名称的归一化不一致，可能将合法保存误判为覆盖冲突。

修改 [cordis.source.patch.yml](cordis.source.patch.yml) 编写自己的策略偏好和流程。`direct` 使用一个原版 DSH 子任务。`cautious` 并发运行两个只能读取、搜索的子任务，然后运行一个实现子任务；`preferences: { speed: "fast" }` 切换为短流程。`allowedPresets` 明确允许可选择的原版 DSH 插件预设。选择预设不会授予文件系统或审批权限。省略工具过滤器会保留预设工具，显式空白名单则不暴露任何工具。

独立载体提供 `ctx.taskStrategies`：`register`、`list`、`catalog`、`decide`、`start`。它注入原版 `agents`、`tools`、`subagents`、`agentPresets`、`jobs` 和 `tokenMeter`。作者可以在调用方 Cordis 生命周期内注册 JavaScript 决策函数，也可以通过载体配置声明按偏好选择的计划。根 Agent 获得 `task_strategy_submit`、`task_strategy_list`、`task_strategy_plan`、`task_strategy_run`，下层子任务不会继承这些控制工具。上层可以选择命名策略或提交显式计划，但只能选择允许的预设。使用原版 `job_list`、`job_output`、`job_kill` 查看或取消；进度包含阶段名与已完成子任务的会话身份。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

注册表只做决策，不加载插件。执行器实施阶段屏障、并发限制、任务数及结果字节上限，将标注的前阶段输出作为数据传递。载体在创建 Job 前检查提供方能力与预设可用性。原版 DSH 进程内驱动在子任务发布前挂载选定预设；权限委托、模型循环、结算及回收仍走原版。一项子任务失败会停止准入并取消兄弟任务，当前阶段排空之后才终止。载体卸载会移除策略注册和工具，但不会取消或等待已经被 Jobs 接收的任务。每个已接收任务保留启动时捕获的计划和限制，并且仍可通过 `job_kill`、所属 Agent 销毁或 Jobs 后端关闭来取消。原有子系统不变量负责 Agent、子任务、预设、工具、Job 所有权，本代码库没有独立注册的不变量。

生命周期决策及边界说明见[已接收 Job 的生命周期决策记录](../../../.agents/notes/implemented/architecture/2026-10-05-task-strategy-job-lifetime.zh.md)。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 独立作者策略注册表 |
| [src/types.ts](src/types.ts) | 计划与执行器契约 |
| [src/executor.ts](src/executor.ts) | 顺序阶段与有界并发 |
| [src/errors.ts](src/errors.ts) | 保证预留结算与清理继续进行的异常转换 |
| [src/task-input.ts](src/task-input.ts) | 统一校验非空任务并保留已接收文本 |
| [src/runtime-types.ts](src/runtime-types.ts) | 任务视图、捕获的绑定和宿主请求 |
| [src/static-plan.ts](src/static-plan.ts) | 独立计划版本和显式阶段选择 |
| [src/task-run.ts](src/task-run.ts) | 任务状态、阶段屏障、替换和取消 |
| [src/admission.ts](src/admission.ts) | 捕获的提供方、预设和工具准入规则 |
| [src/task-submissions.ts](src/task-submissions.ts) | 按所属 Agent 预留重复请求和引用活跃任务 |
| [src/cordis.ts](src/cordis.ts) | 可选的原版 DSH 接入载体 |
| [src/tools.ts](src/tools.ts) | 上层决策和分发工具 |
| [src/schema.ts](src/schema.ts) | 配置与不可信 JSON 校验 |
| [src/selection-types.ts](src/selection-types.ts) | 自动/指定入口及选择限额 |
| [src/selector.ts](src/selector.ts) | 有界结构化选择及子任务清理 |
| [src/client/index.ts](src/client/index.ts) | 生成 Remote 和原版插件 UI 注册 |
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

可选载体通过 `task_strategy_submit` 接收未改写的原始请求，通过 `task_strategy_list` 列出策略描述与允许的预设名，通过 `task_strategy_plan` 预览 JSON 执行计划，通过 `task_strategy_run` 分发显式计划或指定策略。提交回执包含原版 Job id 与所选策略。自动选择的独立子会话记录任务数据、候选描述及结构化结果。下层接收用户任务、选定指令及标注的前阶段文本结果。Job 输出暴露进度与终态报告。主注册表本身不添加提示词段落或工具。

#### Token 影响

只有根 Agent 支付四个决策工具的 schema 成本。自动提交增加一个选择子 Agent，使用小型结果 schema 与有界输出 token；指定策略跳过这部分成本。每个执行子任务支付选定预设及累积前阶段数据的成本。结果和输出字节上限约束保留文本；报告截断带有明确提示，不保证仍是合法 JSON。接收回执保持合法 JSON。

#### KV Cache 影响

上层工具结果追加到历史。选择子 Agent 与执行子任务具有各自的请求前缀；预设、过滤器、路由选择可能改变前缀。不承诺复用父级缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 并发限制针对单次运行，不是多个 Job 的全局配额。工作流是顺序阶段，不是任意 DAG 或持久队列。
- 子任务共享工作文件。工具过滤不是文件系统隔离；并发写入需要作者安排安全流程。
- 没有自动重试、阶段执行中任意暂停或崩溃恢复。`completed` 表示原版模型轮次完成，不代表独立验证正确性。
- 任务状态和请求预留保存在进程内，支持载体重新挂载，不支持进程重启或更换 Jobs 服务。重新挂载需要保留原模块实例。预设实现版本在准入时解析，不会在整个任务期间固定。
- 当前替换支持捕获的静态计划和宿主调用。根输入归属、动态阶段决策程序、持久化任务事件、接入默认产品组合仍待实现。
- 报告只保留文本输出。超过结果字节上限会停止流程；过大的展示文本会明确截断。
- 本功能为实验性显式接入。真实模型执行需要可用的已配置提供方；测试使用免密钥的脚本模型适配器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

构建本包及其依赖后，在仓库根目录运行 `node --test packages/experimental/task-strategy/tests/blackbox.mjs`，检查发布入口、Loader 组合、宿主控制与工具 JSON。对应的局部 E2E 包装测试是 [built-blackbox.e2e.ts](tests/built-blackbox.e2e.ts)。[Headless 会话快照](../../../snapshots/session/task-strategy-empty-input/snapshot.yml) 通过受支持的 `dsh` 启动器重放空白任务预览与分发的拒绝结果。

[选择快照](../../../snapshots/session/task-strategy-selection/snapshot.yml)记录未答复的原版提问、选择器结构化捕获和一个原版执行 Job。客户端装配测试使用原版 Gateway、生成的编解码、设置表单及 slots。

</details>

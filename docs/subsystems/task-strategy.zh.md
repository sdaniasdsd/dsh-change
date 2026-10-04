# 任务策略

[English](task-strategy.md) | 中文

实验性的 [task-strategy 代码库](../../packages/experimental/task-strategy/README.zh.md) 将作者策略身份与 DSH 插件身份分开。可选的 Cordis 载体提供 `ctx.taskStrategies`；原版[子任务](subagent.zh.md)、[预设](core.zh.md)、[Jobs](jobs.zh.md) 负责执行和观察。

## 作者决策与执行计划

[`AuthorStrategy`](../../packages/experimental/task-strategy/src/types.ts) 为作者决策函数命名。`StrategyInput` 包含任务及可选的字符串偏好。`ExecutionPlan` 包含名称与顺序阶段，每阶段包含一个或多个 `TaskStep`。步骤选择预设、指令、可选的工具白名单／黑名单及可选模型路由覆盖项。策略可以根据作者偏好返回不同计划，不注册插件。

`TaskExecutor` 接收步骤、组装后的 prompt 与取消信号，仅在子任务资源释放之后结算。`ExecutionOptions` 指定单次运行的并发、任务数、保留结果字节上限及可选的尽力观察回调。`ExecutionResult` 包含终态与标注的 `TaskResult`。执行器将前阶段结果作为数据传递，失败时取消兄弟任务，并在返回前排空活动子任务。完成只是模型轮次结果，不代表独立验证正确性。确切声明见[源码类型](../../packages/experimental/task-strategy/src/types.ts)。

## 接入原版 DSH

`StrategyDefinition` 提供声明式默认计划与按偏好选择的变体。`AdapterConfig` 限制允许的预设身份，配置提供方、工具名及上限。载体在接受自有 Job 前校验全部阶段。上层 Agent 可以预览策略或分发显式计划，下层子任务不会继承策略控制工具。Jobs 报告阶段与子任务身份，并处理取消。子任务共享文件，作者策略必须协调写入。[包说明](../../packages/experimental/task-strategy/README.zh.md) 负责配置示例与限制。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskstrategies--taskstrategies"></a>

### `ctx.taskStrategies` — `TaskStrategies`

DSH integration; author strategy identities remain outside the plugin registry.

```ts cordis-catalog
/**
 * Register an author strategy under the caller's Cordis lifetime.
 * @param strategy - independent decision function, not a plugin declaration.
 * @returns effect-scoped registration disposer.
 */
register(strategy: AuthorStrategy): () => void

/**
 * List registered author policies without evaluating them.
 * @returns detached author strategy descriptions.
 */
list(): { id: string; description: string }[]

/**
 * Describe the author policies and permitted child compositions.
 * @returns detached strategies and the permitted original DSH preset names.
 */
catalog(): { strategies: { id: string; description: string }[]; presets: string[] }

/**
 * Evaluate an author policy and validate its execution choices.
 * @param id - author strategy name.
 * @param input - task and preferences.
 * @returns detached plan; rejects unavailable or disallowed compositions.
 */
async decide(id: string, input: StrategyInput): Promise<ExecutionPlan>

/**
 * Start an original DSH owned job from an upper-authored or policy-authored plan.
 * @param parent - exact live upper Agent owning the run.
 * @param task - user task shared with all stages.
 * @param plan - captured execution choices.
 * @param signal - admission cancellation; after acceptance use original job cancellation.
 * @returns original DSH job identity; rejects invalid plans before starting work.
 */
async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId>
```

Types: [Agent](core.zh.md) · [JobId](jobs.zh.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->

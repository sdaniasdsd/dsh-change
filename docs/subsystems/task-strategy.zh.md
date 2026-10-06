# 任务策略

[English](task-strategy.md) | 中文

实验性的 task-strategy 库将作者的工作流决策与 DSH 插件身份分开。它的可选 Cordis 载体仅通过显式 profile patch 加载。启用后，`ctx.taskStrategies` 会校验有序计划，并通过 DSH 现有的 preset、subagent 和 Jobs 服务分发各个下层任务；下层 agent 不会获得策略控制工具。

阶段按顺序执行，同一阶段内的任务可以并发。分发前会检查预设与工具过滤器，进度记入 DSH 自有 job。卸载载体会移除其注册，但已接收的 Job 继续遵循 Jobs 服务的生命周期；需要显式取消时使用 `job_kill`。并发任务仍可能共享文件，因此作者需要协调写入。任务轮次结束仅表示子任务已结束，不代表其输出经过独立验证。

计划格式和 profile patch 示例见[包文档](../../packages/experimental/task-strategy/README.zh.md)。

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

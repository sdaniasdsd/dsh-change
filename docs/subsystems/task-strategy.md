# Task strategies

English | [中文](task-strategy.zh.md)

The experimental [task-strategy library](../../packages/experimental/task-strategy/README.md) keeps author policy identities separate from DSH plugin identities. Its optional Cordis carrier exposes `ctx.taskStrategies`; original [subagents](subagent.md), [presets](core.md), and [Jobs](jobs.md) own execution and observation.

## Author decisions and execution plans

[`AuthorStrategy`](../../packages/experimental/task-strategy/src/types.ts) names an author decision function. `StrategyInput` contains a task and optional string-valued preferences. `ExecutionPlan` contains a name and ordered stages; each stage contains one or more `TaskStep` values. A step selects a preset, instructions, an optional tool allow/deny filter, and optional model route overrides. Strategies can return different plans according to author preferences without registering plugins.

`TaskExecutor` accepts a step, assembled prompt, and cancellation signal. It settles only after releasing child resources. `ExecutionOptions` sets per-run concurrency, task count, retained result-byte limits, and an optional best-effort observer. `ExecutionResult` contains a terminal status and labelled `TaskResult` values. The executor passes preceding stage results as data, aborts siblings on failure, and drains active children before returning. Completion is a model-turn outcome, not independent correctness verification. See the [source types](../../packages/experimental/task-strategy/src/types.ts) for exact declarations.

## Original DSH integration

`StrategyDefinition` provides a declarative default plan and preference-selected variants. `AdapterConfig` restricts allowed preset identities and configures provider, tool names, and limits. The carrier validates all stages before accepting an owned Job. The upper Agent can preview a policy or dispatch an explicit plan; lower subagents do not inherit strategy control tools. Jobs report stages and child identities and handle cancellation. Children share files; author strategies must coordinate writes. The [package README](../../packages/experimental/task-strategy/README.md) owns configuration examples and limitations.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md) · [JobId](jobs.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->

# Task strategies

English | [中文](task-strategy.zh.md)

The experimental task-strategy library keeps author workflow decisions separate from DSH plugin identities. Its optional Cordis carrier is loaded only through an explicit profile patch. Once enabled, `ctx.taskStrategies` validates an ordered plan and dispatches each lower task through DSH's existing preset, subagent, and Jobs services. Lower agents do not receive the strategy control tools.

Stages run in order; tasks within a stage may run concurrently. Presets and tool filters are checked before dispatch, and progress is recorded in an owned DSH job. Unloading the carrier removes its registrations but leaves accepted Jobs under the Jobs service lifetime; use `job_kill` for explicit cancellation. Concurrent tasks can still share files, so authors must coordinate writes. Completion means the child turns ended, not that their output was independently verified.

See the [package documentation](../../packages/experimental/task-strategy/README.md) for plan and profile-patch examples.

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

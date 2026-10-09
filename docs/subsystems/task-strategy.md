# Task strategies

English | [中文](task-strategy.zh.md)

The experimental task-strategy library keeps author workflow decisions separate from DSH plugin identities. Its optional Cordis carrier is loaded only through an explicit profile patch. Once enabled, `ctx.taskStrategies` validates an ordered plan and dispatches each lower task through DSH's existing preset, subagent, and Jobs services. Lower agents do not receive the strategy control tools.

Stages run in order; tasks within a stage may run concurrently. Presets and tool filters are checked before dispatch, and progress is recorded in an owned DSH job. Unloading the carrier removes its registrations but leaves accepted Jobs under the Jobs service lifetime; use `job_kill` for explicit cancellation. Concurrent tasks can still share files, so authors must coordinate writes. Completion means the child turns ended, not that their output was independently verified.

See the [package documentation](../../packages/experimental/task-strategy/README.md) for plan and profile-patch examples.

`AuthorStrategy.decide` and `StrategyRegistry.decide` synchronously produce detached plan data; asynchronous work belongs to the executor. The carrier's `ctx.taskStrategies.decide` remains asynchronous because it also performs admission. The package documentation defines author requirements.

Host callers can submit a named strategy with a per-owner `requestId`, inspect its retained task state and request a replacement at a drained stage boundary. The JobId remains stable across replacements. Replacement preserves results and cumulative child limits; failed replacement waits for an explicit resume or another switch. Host controls and process-local state are defined in [runtime-types.ts](../../packages/experimental/task-strategy/src/runtime-types.ts); root model tools expose submit, list, plan and run.

| Type | Host responsibility |
|---|---|
| `TaskSubmission` | Request id, task input, strategy and preferences for one acceptance |
| `TaskIntakeRequest` | Original request id, task and optional automatic/named selection; omission captures the plugin default |
| `TaskReceipt` | Accepted JobId, initial plan name and chosen strategy; not a completion report |
| `TaskSwitch` | Target strategy, observed binding epoch, preferences and explicit zero-based start cursor |
| `TaskRunView` | Committed binding, phase, retained results, cumulative usage and pending switch |

Carrier remount with the same module and Jobs service retains live runs; process restart does not. Captured deployment rules remain fixed for each accepted run, while provider and preset availability are checked at admission. See the package's [limitations](../../packages/experimental/task-strategy/README.md#known-limitations-and-deferred-work) for unimplemented native input routing and persistence.

Switch and resume commands require the `binding.epoch` observed by the caller. The runtime rejects stale expectations before evaluating an author or mutating task state; the carrier never substitutes a fresh epoch. See the [binding-command upgrade guide](../upgrade-guide/v0.2.0-rc.2/task-strategy-binding-commands/guide.md).

`submitTask` reserves the original request id, then selects automatically or plans directly with a named strategy. Automatic selection uses the original child structured capture and creates an owned Job only after cleanup; failures never silently change strategies. Users may choose through the original timed question, unanswered questions still allow execution, and late answers never repeat a task. The original Plugins page exposes Task strategies defaults, routes and deadlines. See the [selection upgrade guide](../upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.md).

Catalogue entries include explainable child-token costs. The registry estimates declared plans at registration; an original task and preferences refine the estimate without evaluating the author. Optional scenario assumptions price expected calls, extra context and output transfer. The selector receives the task-specific catalogue and the Plugins page shows baseline costs and uncertainty. Unknown cost is not zero; parent and selector usage are excluded. See the [estimation contract](../../packages/experimental/task-strategy/README.md#token-estimates) and [migration](../upgrade-guide/v0.2.0-rc.2/task-strategy-cost-catalog/guide.md).

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
 * @param input - optional original task and preferences for task-specific estimates.
 * @returns detached descriptions and child-cost estimates.
 */
list(input?: StrategyInput): StrategyCatalogEntry[]

/**
 * Describe the author policies and permitted child compositions.
 * @returns detached strategies and the permitted original DSH preset names.
 */
@Remote catalog(): { strategies: StrategyCatalogEntry[]; presets: string[] }

/**
 * Evaluate an author policy and validate its execution choices.
 * @param id - author strategy name.
 * @param input - task and preferences.
 * @returns detached plan; rejects unavailable or disallowed compositions.
 */
async decide(id: string, input: StrategyInput): Promise<ExecutionPlan>

/**
 * Submit a named task once per request id under the exact live owner.
 * @param parent - live root Agent owning the original Job.
 * @param request - stable request id, task, strategy and preferences.
 * @param signal - first submitter's admission signal; accepted work uses Jobs cancellation.
 * @returns shared acceptance promise for equal concurrent or repeated requests.
 */
submit(parent: Agent, request: TaskSubmission, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Select automatically or honor a named choice before accepting one original Job.
 * @param parent - exact live root Agent owning the request.
 * @param request - stable original id, unchanged task and optional choice.
 * @param signal - first submitter's cancellation until acceptance.
 * @returns shared receipt including the chosen strategy, after selector cleanup.
 */
submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Read the committed binding and cumulative state of an owned run.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity, unchanged across switches.
 * @returns detached task view; rejects foreign or unavailable Jobs.
 */
inspect(parent: Agent, jobId: JobId): TaskRunView

/**
 * Reserve replacement by a current named strategy at the next stage barrier.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param request - target strategy, observed binding epoch, preferences and optional explicit stage cursor.
 * @returns reservation command number; inspect state or Job output for commitment or failure.
 */
requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): number

/**
 * Continue the retained strategy after a rejected replacement.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - waiting task identity.
 * @param expectedBindingEpoch - binding epoch observed by the caller; stale expectations cannot resume a different binding.
 */
resume(parent: Agent, jobId: JobId, expectedBindingEpoch: number): void

/**
 * Start an original DSH owned job from an upper-authored or policy-authored plan.
 * @param parent - exact live upper Agent owning the run.
 * @param task - nonblank user task shared with all stages, preserving its whitespace.
 * @param plan - captured execution choices.
 * @param signal - admission cancellation; after acceptance use original job cancellation.
 * @returns original DSH job identity; rejects invalid plans before starting work.
 */
async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId>
```

Types: [Agent](core.md) · [JobId](jobs.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->

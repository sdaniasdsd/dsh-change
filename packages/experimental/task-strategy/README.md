---
description: "Author-owned workflow decisions, independent of DSH plugins, with an opt-in Cordis carrier."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-task-strategy

English | [中文](README.zh.md)

## Summary

Write named author strategies that choose task stages, child plugin presets, tool restrictions, and model routes. The main module is a plain library: strategy identities never enter the DSH plugin registry. Its optional `./cordis` carrier mounts through the same Cordis mechanism as other services and executes through original DSH subagents and owned Jobs. Nothing changes in the default product composition.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

<a id="token-estimates"></a>
### Explainable token estimates

`list()` returns each strategy's `cost`; `list({ task, preferences })` refines it for the task and selected preference variant without calling `decide`. The carrier reuses DSH's TokenMeter and requires that service. Independent registries accept a text estimator in their constructor; absent estimators and undeclared dynamic plans report unknown cost.

Declarative strategies may set `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }`. All values are safe integers; calls are positive and context/output may be zero. These explicit scenario assumptions estimate repeated input, generated output and transfer to later stages. They do not limit execution. Without assumptions, the catalogue reports known task/instruction/result-framing input and task/stage counts, with no total. Session ids, JSON escaping, actual history, reasoning, tokenizer and cache effects remain uncertain. Parent and selector usage are excluded.

Use `task_strategy_list({ task, preferences? })` for model-visible estimates. Automatic selection receives the same task-specific data and prefers suitable workflows before comparing cost. The original Plugins page displays registration costs, assumptions and uncertainty. Registration estimates exclude the task body and are approximate, not billed usage or a guaranteed bound.

The opt-in [workflow configuration](../../../strategies/workflows.patch.yml) supplies coding, paper research, problem research and solution planning at three tiers; its numbers are editable scenario assumptions. See [configuration and tier selection](../../../strategies/README.md#workflow-library).

### Independent author decisions

Task text must contain a non-whitespace character. Decisions, previews and dispatch reject blank tasks before author evaluation or child admission; accepted text keeps its original whitespace.

`AuthorStrategy.decide` and `StrategyRegistry.decide` return `ExecutionPlan` synchronously; author errors throw synchronously. Authors must use trusted, finite plan computation without I/O. Put asynchronous research, model calls and tools in the cancellable executor. The carrier's `ctx.taskStrategies.decide` remains asynchronous because it also performs admission. See the [synchronous-decision upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-synchronous-decisions/guide.md) for migration from the previous author interface.

Import `StrategyRegistry` and `executePlan` from the main entry. Register `{ id, description, decide(input) }`; the decision receives `{ task, preferences }` and returns an `ExecutionPlan`. `register` returns a disposer; duplicate names reject. Decisions and input are detached snapshots. Plans contain ordered stages; tasks within one stage run concurrently up to `maxConcurrent`. Each task names `label`, `preset`, and `instruction`, with optional `tools: { allow, deny }`, `model`, and `provider`. The pure executor accepts your cancellation-aware `TaskExecutor`; that callback must settle after releasing resources.

### Task-owned strategy replacement

`TaskRun` and `captureStrategy` provide a plain-library runtime for captured static plans. A run retains its task input, results, cumulative child admissions and result-byte limit across replacement. `requestSwitch(load, { expectedBindingEpoch, startStage })` immediately reserves a command and synchronously captures its target plan; the current stage drains before admission and binding commitment. The target cursor is an explicit zero-based index, defaulting to zero. A rejected switch enters `waiting` with the previous binding intact; `resume(expectedBindingEpoch)` continues that binding, or another switch can select a different target. Both commands require the nonnegative safe-integer `binding.epoch` observed through `inspect()`; stale expectations reject before author evaluation or state change. `cancel(reason)` aborts active execution and settles after cleanup. `load` must synchronously return captured plan data; asynchronous work belongs to the executor.

The carrier exposes host methods `submit(parent, request, signal)`, `inspect(parent, jobId)`, `requestSwitch(parent, jobId, request)` and `resume(parent, jobId, expectedBindingEpoch)`. `submit` requires `{ requestId, strategy, task, preferences? }`: equal requests under the same live Agent share one admission and receipt; reusing the id with different input rejects. Rejected admissions release their reservation. The first submitter's signal owns admission cancellation; later duplicate calls do not cancel accepted work. Use original Jobs operations to wait or cancel. Switch requests require `{ strategy, expectedBindingEpoch, preferences?, startStage? }`; pass the epoch from the view used to make the choice. `requestSwitch` returns a reservation number, and `inspect` or Job logs report the committed binding. After an epoch mismatch, inspect again and explicitly reconsider the command. These host controls add no model tools or input routing.

Accepted runs retain their captured deployment rules when the carrier reloads. A newly mounted carrier can control them through the same live Agent and Jobs service. A switch captures the newly selected plan under the current registry, then admits it under the run's retained rules. Thus a newly allowed preset requires a new run if the original run did not authorize it. This slice uses the original JobId as the task identity.

### Automatic intake and optional choice

Use `submitTask(parent, { requestId, task, selection?, preferences? }, signal)`. Omitted selection captures the current plugin default; `{ kind: 'auto' }` selects from registered candidates, while `{ kind: 'named', strategy }` bypasses the selector. The receipt contains `{ jobId, name, strategy }`. Equal repeated requests share the reserved promise; conflicting input rejects; failed intake releases the id.

Tool receipts preserve complete Job and strategy identities, shortening only oversized display names. Before accepting a Job, intake limits the JSON-encoded strategy id to the carrier's `maxOutputBytes` minus 256 bytes reserved for original Jobs metadata. This prevents a long id from destroying the acknowledgement at the minimum 512-byte output limit.

If remounting lowers that limit below an already accepted receipt's identity size, a repeated tool call reports that the Job is already accepted and gives its id. Use `job_output`, or restore the previous limit and repeat the same request. The retained host receipt and request reservation remain unchanged; the task does not run again.

Automatic selection uses an original child with only its local `structured_output` tool, unchanged task data, preferences and captured candidate descriptions. Defaults are a 30,000 ms deadline, 32,768 prompt bytes, 2,048 result bytes and 512 output tokens. Invalid capture, timeout, cancellation or removal of the chosen strategy rejects before an execution Job is created. Selector cleanup precedes acceptance. Author decisions remain synchronous. Named intake avoids the selector cost.

Optional questions use the original timed `ask_user_question` before `task_strategy_submit`. No answer means the configured default still runs. A late reply never creates a new id or repeats the original task; accepted tasks use existing host controls for stage-boundary switching. Ordinary chat reaches this opt-in tool through the original model loop; the plugin does not intercept every message.

The web half registers **Task strategies** in the original Plugins page. It edits default mode/name, model/provider route and deadline through staged forms and revision-fenced writes. Byte and token limits remain in Loader configuration. Live `Volatile` references affect future intake; accepted Jobs keep captured rules. Catalogue reads discard obsolete responses after reconnect/unload and retain displayed entries on refresh failure. The generated Remote exposes only `catalog`. See the [selection upgrade guide](../../../docs/upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.md).

### DSH source trial

From the repository root, use the supported named-profile launcher:

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

The original ConfigEditor refuses saves that a command-line overlay would override; the page keeps the draft and reports failure. For editable plugin defaults, copy the overlay's insert rows into the active `<DSH_HOME>/profiles/web/cordis.patch.yml`, replace the relative carrier name with its absolute source file URL (obtain it with Node's `pathToFileURL`, or use an installed `@deepseek-ai/dsh-experimental-task-strategy/cordis` export), and launch that profile without the strategy `--patch`. The profile patch then owns configuration persistence. Use the file URL because the original editor's preview does not normalize local path names consistently with profile loading and can incorrectly reject a save as an override conflict.

Edit [cordis.source.patch.yml](cordis.source.patch.yml) to author strategy preferences and flows. `direct` uses one original DSH child. `cautious` runs two read/search-only children concurrently, then one implementation child; `preferences: { speed: "fast" }` selects a shorter flow. `allowedPresets` explicitly authorizes original DSH preset compositions. Selecting a preset does not grant filesystem or approval permissions. Omitting a tool filter preserves that preset's tools; an explicit empty allowlist exposes no tools.

The separate carrier provides `ctx.taskStrategies`: `register`, `list`, `catalog`, `decide`, and `start`. It injects original `agents`, `tools`, `subagents`, `agentPresets`, `jobs`, and `tokenMeter`. Authors may register JavaScript decision functions under their caller's Cordis lifetime, or declare preference-selected plans in carrier configuration. Root agents receive `task_strategy_submit`, `task_strategy_list`, `task_strategy_plan`, and `task_strategy_run`; lower subagents do not inherit these control tools. Upper agents may select a named policy or submit an explicit plan, but may only select allowed presets. Observe and cancel using original `job_list`, `job_output`, and `job_kill`; progress includes stage names and completed child session identities.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The registry decides without loading plugins. The executor imposes stage barriers, concurrency, task-count and result-byte bounds, and passes labelled prior-stage outputs as data. The carrier preflights provider capabilities and preset availability before starting a job. Original in-process DSH drivers mount the chosen preset during unpublished child setup; child permission delegation, model loop, settlement, and cleanup remain original. A failed child stops admissions and cancels siblings; the stage drains before terminal settlement. Carrier unload removes strategy registrations and tools but does not cancel or wait for Jobs already accepted. Each accepted job keeps its captured plan and limits and remains cancellable through `job_kill`, owner disposal, or Jobs-backend shutdown. Existing subsystem invariants cover original Agent, subagent, preset, tool, and Job ownership; this library has no independently registered invariant.

See the [accepted Job lifetime decision](../../../.agents/notes/implemented/architecture/2026-10-05-task-strategy-job-lifetime.md) for the lifecycle rationale and boundaries.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Independent author registry |
| [src/types.ts](src/types.ts) | Plans and executor contracts |
| [src/executor.ts](src/executor.ts) | Ordered stages and bounded concurrency |
| [src/errors.ts](src/errors.ts) | Failure rendering that preserves reservation settlement and cleanup |
| [src/task-input.ts](src/task-input.ts) | Shared nonblank task validation, preserving accepted text |
| [src/runtime-types.ts](src/runtime-types.ts) | Task views, captured bindings and host requests |
| [src/static-plan.ts](src/static-plan.ts) | Detached plan revisions and explicit stage selection |
| [src/task-run.ts](src/task-run.ts) | Task state, stage barriers, replacement and cancellation |
| [src/admission.ts](src/admission.ts) | Captured provider, preset and tool admission rules |
| [src/task-submissions.ts](src/task-submissions.ts) | Owner-scoped duplicate reservation and live run references |
| [src/cordis.ts](src/cordis.ts) | Optional original-DSH integration carrier |
| [src/tools.ts](src/tools.ts) | Upper decision and dispatch tools |
| [src/schema.ts](src/schema.ts) | Configuration and untrusted JSON validation |
| [src/selection-types.ts](src/selection-types.ts) | Automatic/named intake and selection limits |
| [src/selector.ts](src/selector.ts) | Bounded structured choice and child cleanup |
| [src/client/index.ts](src/client/index.ts) | Generated Remote and original plugin UI registration |
| [tests/adapter.spec.ts](tests/adapter.spec.ts) | Real Loader composition and keyless model-loop recording |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Subagent contracts](../../subagent/subagent/README.md)
- [Preset registry](../../preset/agent-preset-registry/README.md)
- [Local jobs](../../jobs/jobs-local/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Upper decision tools and lower task input

#### What the model sees

The optional carrier accepts an unchanged original request through `task_strategy_submit`, lists strategy descriptions and allowed preset names through `task_strategy_list`, previews a JSON execution plan through `task_strategy_plan`, and dispatches an explicit plan or named strategy through `task_strategy_run`. Submission returns the original Job id and selected strategy. Automatic selection records a separate child session containing the task data, candidate descriptions and structured capture. Lower tasks receive the user's task, their selected instructions, and labelled prior-stage text results. Job output exposes progress and the terminal report. The main registry itself adds no prompt sections or tools.

#### Token effect

Only root agents pay for the four decision-tool schemas. Automatic intake adds a selector child with a small result schema and bounded output tokens; named intake bypasses that cost. Each execution child pays for its chosen preset and accumulated prior-stage data. Result and output byte ceilings bound retained text; report truncation includes an explicit notice and need not remain valid JSON. Acceptance receipts remain valid JSON.

#### KV Cache effect

Upper tool results append to history. Selector and execution children have separate request prefixes; preset, filter, or route selection can change those prefixes. No parent cache reuse is promised.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Concurrency is per run, not a global quota across multiple jobs. The workflow is ordered stages, not an arbitrary DAG or durable queue.
- Children share working files. Tool filtering is not filesystem isolation; concurrent writes require an author-chosen safe flow.
- Automatic retries, arbitrary mid-stage pause and crash recovery are absent. `completed` means the original model turn completed, not independent correctness verification.
- Task state and request reservations are process-local; they survive carrier remount, not process restart or replacement of the Jobs service. The old module instance must remain loaded for that remount. Preset implementation revisions are resolved at admission rather than pinned across the entire task.
- Replacement currently supports captured static plans and host calls. Root input ownership, dynamic stage decision programs, durable task events and promotion into the default product composition remain deferred.
- Reports retain text output only. Byte-limit failures stop the flow; oversized presentation text is explicitly truncated.
- This is experimental and opt-in. Real model execution requires an available configured model provider; tests use a scripted, keyless model adapter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

After building the package and its dependencies, run `node --test packages/experimental/task-strategy/tests/blackbox.mjs` from the repository root to exercise published exports, Loader composition, host controls and tool JSON. The focused E2E wrapper is [built-blackbox.e2e.ts](tests/built-blackbox.e2e.ts). The [headless session snapshot](../../../snapshots/session/task-strategy-empty-input/snapshot.yml) replays blank preview and dispatch rejection through the supported `dsh` launcher.

The [selection snapshot](../../../snapshots/session/task-strategy-selection/snapshot.yml) records an unanswered native question, structured selector capture and one original execution Job. Client assembly tests use original Gateway, generated codecs, settings forms and slots.

</details>

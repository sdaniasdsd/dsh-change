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

### Independent author decisions

Import `StrategyRegistry` and `executePlan` from the main entry. Register `{ id, description, decide(input) }`; the decision receives `{ task, preferences }` and returns an `ExecutionPlan`. `register` returns a disposer; duplicate names reject. Decisions and input are detached snapshots. Plans contain ordered stages; tasks within one stage run concurrently up to `maxConcurrent`. Each task names `label`, `preset`, and `instruction`, with optional `tools: { allow, deny }`, `model`, and `provider`. The pure executor accepts your cancellation-aware `TaskExecutor`; that callback must settle after releasing resources.

### DSH source trial

From the repository root, use the supported named-profile launcher:

```powershell
node --import tsx/esm apps/cli/lib/bin.js --profile web --patch packages/experimental/task-strategy/cordis.source.patch.yml --no-open --port 3090
```

Edit [cordis.source.patch.yml](cordis.source.patch.yml) to author strategy preferences and flows. `direct` uses one original DSH child. `cautious` runs two read/search-only children concurrently, then one implementation child; `preferences: { speed: "fast" }` selects a shorter flow. `allowedPresets` explicitly authorizes original DSH preset compositions. Selecting a preset does not grant filesystem or approval permissions. Omitting a tool filter preserves that preset's tools; an explicit empty allowlist exposes no tools.

The separate carrier provides `ctx.taskStrategies`: `register`, `list`, `catalog`, `decide`, and `start`. It injects original `agents`, `tools`, `subagents`, `agentPresets`, and `jobs`. Authors may register JavaScript decision functions under their caller's Cordis lifetime, or declare preference-selected plans in carrier configuration. Root agents receive `task_strategy_list`, `task_strategy_plan`, and `task_strategy_run`; lower subagents do not inherit these control tools. Upper agents may select a named policy or submit an explicit plan, but may only select allowed presets. Observe and cancel using original `job_list`, `job_output`, and `job_kill`; progress includes stage names and completed child session identities.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The registry decides without loading plugins. The executor imposes stage barriers, concurrency, task-count and result-byte bounds, and passes labelled prior-stage outputs as data. The carrier preflights provider capabilities and preset availability before starting a job. Original in-process DSH drivers mount the chosen preset during unpublished child setup; child permission delegation, model loop, settlement, and cleanup remain original. A failed child stops admissions and cancels siblings; the stage drains before terminal settlement. Adapter unload cancels and drains active runs. Existing subsystem invariants cover original Agent, subagent, preset, tool, and Job ownership; this library has no independently registered invariant.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Independent author registry |
| [src/types.ts](src/types.ts) | Plans and executor contracts |
| [src/executor.ts](src/executor.ts) | Ordered stages and bounded concurrency |
| [src/cordis.ts](src/cordis.ts) | Optional original-DSH integration carrier |
| [src/tools.ts](src/tools.ts) | Upper decision and dispatch tools |
| [src/schema.ts](src/schema.ts) | Configuration and untrusted JSON validation |
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

The optional carrier lists strategy descriptions and allowed preset names through `task_strategy_list`, previews a JSON execution plan through `task_strategy_plan`, and returns an original Job id on dispatch through `task_strategy_run`. Lower tasks receive the user's task, their selected instructions, and labelled prior-stage text results. Job output exposes progress and the terminal report. The main registry itself adds no prompt sections or tools.

#### Token effect

Only root agents pay for the three decision-tool schemas. Each child pays for its chosen preset and accumulated prior-stage data. Result and output byte ceilings bound retained text; truncated text includes an explicit notice and need not remain valid JSON.

#### KV Cache effect

Upper tool results append to history. Each child has its own request prefix; preset, filter, or route selection can change that prefix. No parent cache reuse is promised.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Concurrency is per run, not a global quota across multiple jobs. The workflow is ordered stages, not an arbitrary DAG or durable queue.
- Children share working files. Tool filtering is not filesystem isolation; concurrent writes require an author-chosen safe flow.
- Automatic retries, pause/resume, and crash recovery are absent. `completed` means the original model turn completed, not independent correctness verification.
- Reports retain text output only. Byte-limit failures stop the flow; oversized presentation text is explicitly truncated.
- This is experimental and opt-in. Real model execution requires an available configured model provider; tests use a scripted, keyless model adapter.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

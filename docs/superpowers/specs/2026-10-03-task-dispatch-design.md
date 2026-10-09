# Task dispatch layer — proposed design

English | [中文](2026-10-03-task-dispatch-design.zh.md)

## Summary

This is a review draft, not documentation of implemented behavior. The upper layer decides which tasks to dispatch and when; the original DSH runtime executes each task. The addition exposes task activity and outcomes without changing the agent loop or introducing an external workflow framework.

## Scope and assumptions

The first version runs inside one DSH process as an opt-in Cordis plugin. A parent agent submits independent tasks and receives task IDs immediately. The dispatcher owns accepted work across the submitting tool call's return; parent disposal or dispatcher unload cancels and drains that work. Ending an ordinary parent turn does not cancel it.

The proposed first delivery includes submission, bounded concurrency, listing, inspection, and cancellation through model-facing tools and a typed service. A new graphical dashboard, automatic task decomposition, dependency graphs, automatic retries, distributed workers, and crash recovery are excluded. These are first-version assumptions for review, not previously agreed requirements.

Task records and bounded activity summaries are initially process-local. Original DSH session persistence remains unchanged. Restart loses the dispatch queue; the plugin never automatically redispatches an uncertain task. Persisted child sessions, where available, do not imply a recoverable dispatch queue.

## Integration choice

Use a plugin over the existing subagent service. The alternative of adapting the workflow engine would couple dispatch to script execution and foreground collection; an external SDK service would add a process protocol and deployment. The plugin keeps the requested dispatch policy local and leaves DSH execution unchanged.

The verified entry is `ctx.subagents.start(name, request)` in [the subagent service](../../../packages/subagent/subagent/src/index.ts). Its [run and result types](../../../packages/subagent/subagent/src/types.ts) expose child identity, an optional local agent, a terminal result, and asynchronous disposal. The first adapter uses the original in-process spawn provider. Separate sessions isolate conversation state, not shared files or external side effects.

## Dispatch and observation

The proposed service is `ctx.taskDispatcher`, with `submit`, `list`, `get`, `cancel`, and observer registration. Proposed consumer tools are `task_dispatch`, `task_status`, and `task_cancel`. These names are additions, not existing DSH APIs. Every operation is scoped to its owning parent; another parent cannot inspect or cancel a task by guessing its ID.

Submission accepts a task kind, label, and explicit prompt. Configured task kinds select an allowed execution preset; unknown kinds fail before acceptance. The upper caller chooses task content and ordering. The dispatcher applies FIFO admission and a validated positive concurrency limit. It performs no planning, prompt rewriting, result judging, or follow-up injection.

A branded task ID exists before queue admission; the child session ID is attached after publication. Duplicate caller request IDs return the original task within the same parent and process; conflicting payloads fail. Provisioning consumes capacity, and capacity is released only after child cleanup finishes.

The task lifecycle is `queued`, `starting`, `running`, `cancelling`, then `completed`, `failed`, or `cancelled`. A separate activity field describes the latest observed step or tool operation. Waiting for input is shown only when an explicit DSH interaction event establishes it; lack of output never implies waiting or failure.

Observers receive detached snapshots with a task-local sequence, timestamps, task ID, and child session ID when known. Register listeners before starting work so early events are not lost; correlate provisional child events through the existing subagent lifecycle and parent ownership. Bound retained events and preview sizes through configuration. Report truncated history explicitly. Observer exceptions do not interrupt execution or other observers.

Map the authoritative run result to the terminal task state and retain the original stop reason. `completed` means the child run ended normally, not that the user's goal was independently verified. A refusal, token ceiling, error, or unknown non-completed stop reason is a failed run with its original reason. An infrastructure rejection is reported separately from assistant output. Agent idle is never used as proof of task success.

## Cancellation and resource ownership

Each accepted task has its own cancellation controller. Cancelling a queued task prevents child creation. Cancelling during provisioning aborts startup and waits for cleanup. Cancelling a published child forwards cancellation and awaits its result and disposal. A cancellation request is shown as `cancelling` until execution has stopped; a settled terminal task remains immutable.

The dispatcher owns every returned run handle and disposes it in all completion paths. Shutdown rejects new submissions, closes observer delivery, cancels pending and active work, and awaits quiescence. A sibling's failure or cancellation does not cancel unrelated tasks. Cleanup failure remains visible and does not silently free capacity while work may still exist.

Concurrent tasks may share files and external systems. First-version callers must submit non-conflicting work; this plugin provides no filesystem isolation, automatic merging, or exactly-once external effects. Potentially conflicting writes must be dispatched sequentially. DSH's existing permissions and approval policy remain in force.

## Acceptance evidence

Implementation acceptance requires focused tests for queue order and capacity, isolated task identities, early events, task-kind validation, duplicate submission, observer failures, child failure, and cancellation before, during, and after startup. It also requires unload/drain tests, parent ownership checks, and event-retention limits.

A keyless recorded-session scenario must exercise submission through the actual tool consumer, concurrent child activity, status inspection, and a terminal result using the original DSH driver with a test model provider. Model-facing output needs snapshot coverage. Type checks and affected documentation checks accompany the implementation; paid model calls are not required to prove scheduling behavior.

## Dev Note

This draft awaits user review. No dispatcher implementation, dependency installation, or runtime verification is represented by this document. The next stage is a file-level implementation plan after the user confirms the first-version scope.

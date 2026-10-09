---
kind: upgrade-guide
description: "Task-strategy author decisions and replacement callbacks require synchronous plan data."
---

# Synchronous task-strategy decisions

English | [中文](guide.zh.md)

## Change

The public experimental task-strategy package requires `AuthorStrategy.decide(input): ExecutionPlan` and `TaskRun.requestSwitch(load, { expectedBindingEpoch })` callbacks returning `CapturedStrategy` synchronously. Previously, both accepted asynchronous decisions. `StrategyRegistry.decide` now returns `ExecutionPlan` directly and throws author or lookup errors synchronously. This affects custom author strategies and direct library consumers; configured static plans retain their behavior. The Cordis carrier's `ctx.taskStrategies.decide` still returns a Promise for asynchronous admission checks.

## Migration

1. In custom strategy modules, remove `async` from `AuthorStrategy.decide`; return a plain `ExecutionPlan` through trusted, finite computation. Move model calls, tools, and other asynchronous I/O into child tasks or your cancellable `TaskExecutor`.
2. Update direct `StrategyRegistry.decide` callers that use `.then` or `.catch` to read the returned plan and handle synchronous exceptions. Existing `await` callers can migrate to direct calls.
3. For direct `TaskRun.requestSwitch` calls, synchronously return `captureStrategy(id, plan)` and pass the binding epoch from the view used to choose the switch; the runtime captures that data before returning the command. Keep asynchronous capability admission in `TaskRunOptions.prepare`. See [guarded controls](../task-strategy-binding-commands/guide.md) for epoch and cursor arguments.
4. Compile your strategy consumers, execute one stage-boundary replacement, and cancel an accepted task during active execution. Confirm the same JobId is retained and owner disposal finishes after child cleanup. See the [package contract](../../../../packages/experimental/task-strategy/README.md).

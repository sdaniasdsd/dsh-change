# Task strategies

English | [中文](task-strategy.zh.md)

The experimental task-strategy library keeps author workflow decisions separate from DSH plugin identities. Its optional Cordis carrier is loaded only through an explicit profile patch. Once enabled, `ctx.taskStrategies` validates an ordered plan and dispatches each lower task through DSH's existing preset, subagent, and Jobs services. Lower agents do not receive the strategy control tools.

Stages run in order; tasks within a stage may run concurrently. Presets and tool filters are checked before dispatch, progress is recorded in an owned DSH job, and unloading the carrier cancels and drains its active child work. Concurrent tasks can still share files, so authors must coordinate writes. Completion means the child turns ended, not that their output was independently verified.

## Service API

The root package exposes the `TaskStrategies` type and `ctx.taskStrategies` type augmentation. Its methods are implemented by the optional `./cordis` carrier:

- `list()` and `catalog()` enumerate registered author policies and allowed presets without running a decision.
- `register(strategy)` adds an author decision for the caller's Cordis lifetime.
- `decide(id, input)` returns a detached plan after validating presets and child capabilities.
- `start(parent, task, plan, signal)` creates an original DSH Job and dispatches each step through the configured original DSH subagent provider.

The API type is available from the root library, but the runtime service and tools remain absent until the carrier is explicitly loaded.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->
<!-- END GENERATED cordis-surface -->

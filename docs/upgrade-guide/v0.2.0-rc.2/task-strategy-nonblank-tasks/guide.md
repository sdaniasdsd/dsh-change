---
kind: upgrade-guide
description: "Experimental task-strategy decisions and execution reject blank task text."
---

# Nonblank task-strategy input

English | [中文](guide.zh.md)

## Change

The public experimental task-strategy package rejects an empty or whitespace-only task with `Task must not be empty`. This applies to `StrategyRegistry.decide`, `TaskRun` construction, `executePlan`, and the optional Cordis carrier's decision, submission and dispatch paths, including model tools. Previously, a blank task could create a Job and start children. Rejection happens before author evaluation or child admission; accepted task text retains its whitespace.

## Migration

1. In callers of these APIs and tools, supply a task body containing at least one non-whitespace character. Replace blank task placeholders with the actual task before preview or dispatch.
2. Handle synchronous exceptions from registry decisions and `TaskRun` construction, or Promise rejection from asynchronous execution and carrier APIs. Model tools report the error without creating a Job; correct the task and retry.
3. Run one valid task and one whitespace-only task. Confirm the latter creates no Job or child. See the [package contract](../../../../packages/experimental/task-strategy/README.md).

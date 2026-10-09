---
kind: upgrade-guide
description: "Experimental task-strategy switch and resume commands require the caller's observed binding epoch."
---

# Guarded task-strategy controls

English | [中文](guide.zh.md)

## Change

The public experimental task-strategy package requires an observed binding epoch on switch and resume commands. `TaskSwitch` adds required `expectedBindingEpoch`; carrier `resume(parent, jobId, expectedBindingEpoch)` adds a third argument. Direct callers use `TaskRun.requestSwitch(load, { expectedBindingEpoch, startStage })` and `TaskRun.resume(expectedBindingEpoch)`. Previously, the direct switch's second argument selected the target stage and commands required no epoch. The runtime rejects invalid or mismatched epochs synchronously before author evaluation or task mutation. Cancellation through original Jobs is unchanged.

## Migration

1. Read the task view used to choose a control action with `inspect(parent, jobId)` or `run.inspect()` and retain its `binding.epoch`.
2. Add `expectedBindingEpoch: view.binding.epoch` to host switch requests; pass that observed epoch to host or direct resume calls.
3. For direct switch calls, replace the old numeric cursor argument with `{ expectedBindingEpoch: view.binding.epoch, startStage: oldCursor }`. Omit `startStage` to begin at stage 0. The object makes old numeric calls fail compilation instead of interpreting a stage index as an epoch. Do not replace a caller's older expectation with the current epoch inside an adapter.
4. Handle epoch mismatch by reading the view again and explicitly reconsidering the action. Compile consumers and verify an old epoch cannot change the binding, invoke the author or resume a waiting task. See the [package documentation](../../../../packages/experimental/task-strategy/README.md).

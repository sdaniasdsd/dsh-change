---
kind: upgrade-guide
description: "Experimental strategy catalogues add structured cost data and the carrier requires TokenMeter."
---

# Task strategy cost catalogue

English | [中文](guide.zh.md)

## Change

`StrategyRegistry.list`, `ctx.taskStrategies.list` and `catalog` now return strategy entries with required `cost` data. Estimates include known input and child counts, optional explicit scenario totals, and uncertainty. The carrier requires original `tokenMeter` alongside its existing services. Automatic selection receives task-specific cost data. Existing strategy configurations remain accepted without `tokenCost`.

## Migration

1. Mount `@deepseek-ai/dsh-token-meter` when manually composing the carrier. The standard base bundle already supplies it; custom Loader fixtures must add it.
2. Update catalogue producers and exact-shape fixtures to include `cost`. Opaque author decisions without declarative costing use `{ kind: 'unknown', reason: 'dynamic-plan' }`. Consumers must not interpret unknown cost as zero.
3. Supply optional `cost: { plan, variants?, assumptions? }` when registering a static author policy. Independent registries accept the owning text estimator in `new StrategyRegistry(measure)`; without it, costs remain unknown.
4. Configure optional `tokenCost: { callsPerTask, contextTokensPerCall, outputTokensPerCall }` on declarative strategies. These are scenario assumptions, separate from execution limits. Use `task_strategy_list` with optional `task` and `preferences`; preferences require the original task. Confirm the returned `basis` is `task` and the selected variant's task count matches. The Plugins page shows registration estimates excluding task text.

See [the estimation contract](../../../../packages/experimental/task-strategy/README.md#token-estimates).

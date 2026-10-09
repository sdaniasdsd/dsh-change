# Task Strategy Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the user-approved independent strategy component and expose it in an opt-in enhanced DSH web instance.

**Architecture:** A pure TypeScript decision registry and phased executor remain separate from a Cordis integration adapter. The adapter uses DSH presets, one-shot spawn, and owned jobs; original agent execution and plugin registration remain authoritative.

**Tech Stack:** TypeScript, Cordis, DSH, Vitest, pnpm.

**Spec:** ../specs/2026-10-04-task-strategy-design.md

## Global Constraints

- No agent-loop edits, plugin installation, or default-profile changes.
- Missing preset/provider/capability fails before task execution.
- Run disposal waits for child cleanup; only completed children allow the next stage.
- Focused tests only; no repository-wide test suite by default.
- Use current checkout for the explicitly requested source build; preserve existing draft files and user configuration.

## Review Focus

- Empty, oversized, or malformed plans must not spawn children.
- Cancellation while starting a child must drain published and pending work.
- Preset selection must match both model-visible tools and durable child metadata.
- Author strategy removal must not remove a newer registration or corrupt accepted plans.
- Partial failure must not start later stages or falsely report completion.

### Task 1: Explicit one-shot child composition

**Files:** subagent request/capability types and validation; shared child composition and in-process driver; spawn/fork providers; preset-inheritance tests; owning documentation.

**Interfaces:** Produce optional `SubagentStartRequest.agentPreset` and opt-in `SubagentCapabilities.agentPreset`; preserve existing defaults and exclude the new field from continuable requests.

- [x] Add tests selecting reviewing from a coding parent, filtering selected tools, and rejecting an unknown preset.
- [x] Run `pnpm exec vitest run packages/subagent/subagent-in-process-driver/tests/preset-inheritance.spec.ts`; observe incorrect inherited tools before implementation.
- [x] Implement selection during unpublished child setup and persist selected preset identity.
- [x] Run relevant driver, inheritance, and subagent service tests; expect zero failures.

### Task 2: Independent strategy component

**Files:** packages/experimental/task-strategy/src/{types,index,executor}.ts and package tests/manifests/config.

**Interfaces:** Produce `StrategyRegistry.register/list/decide` and `executePlan(plan, executor, options)`; consume a typed cancellable task executor rather than DSH plugins.

- [x] Add tests for custom preferences, registration removal, ordered stages, bounded parallelism, abort, failures, and result byte limits.
- [x] Run component tests before implementation; observe missing strategy behavior.
- [x] Implement the registry and phased executor with detached plans and configurable limits.
- [x] Run component tests; expect zero failures.

### Task 3: DSH adapter and enhanced launch

**Files:** component src/cordis.ts, schema and tool consumers, Loader fixture/tests, README pair, opt-in source overlay, host aggregate.

**Interfaces:** Consume Task 1 requests and Task 2 plans; expose `ctx.taskStrategies`, strategy list/plan/run tools, and original jobs for progress/status/cancel.

- [x] Add a Loader-composed keyless integration test with original AgentLoop/spawn/jobs and selected preset tools.
- [x] Implement adapter and declarative author strategies; expose explicit upper-authored plan dispatch.
- [x] Run integration snapshot, targeted type/build checks, and documentation checks; inspect output.
- [x] Perform fresh-context code review and fix material findings with regression tests.
- [x] Launch `dsh web --patch` with the enhanced overlay on a free local port and verify strategy-tool presence.

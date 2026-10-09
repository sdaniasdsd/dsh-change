# Task strategy runtime implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Steps use checkbox syntax for tracking.

**Goal:** Implement the first B slice: one owned Job retains task results and cumulative limits while two captured static strategies can hand over at a drained stage boundary.

**Architecture:** Keep this slice in the existing experimental package. A Cordis-independent TaskRun owns phase, results and cancellation; a static-plan adapter owns the cursor; the existing executor remains the sole child execution implementation. The Cordis adapter supplies preflight, Jobs and subagents. The full workflow package promotion, root input ownership, persisted journal and UI remain subsequent work described by the approved framework.

**Tech Stack:** TypeScript, existing Cordis/Jobs/subagents, Node.js, existing workspace compiler; no new dependency.

**Spec:** [Approved B framework](../../../../DSH策略层B方案-模块与接口框架-2026-10-09.md).

## Global constraints

- Preserve the existing opt-in composition and existing three model tools.
- Retain the same JobId across switches; in this slice it also identifies the task run.
- A switch starts from an explicit zero-based target stage; default is stage 0, never inferred from stage names.
- Commit the target binding only after target-stage preflight succeeds and cancellation is rechecked.
- Keep completed results and cumulative child admissions across switches; do not retry side effects automatically.
- Capture plain plan data and limits; accepted Jobs outlive carrier reload. Preset implementation revisions are not pinned by this slice.
- Reuse the existing executor for concurrency, failure propagation, cleanup and result-byte accounting.
- Verify lifecycle and concurrency through focused unit tests and the existing real Loader composition; avoid the full repository suite.

## Review focus

1. Switch requested during running children: all children settle and release before the next binding commits.
2. Cancellation during target resolution or preflight: no target child starts; settlement waits for owned asynchronous preparation.
3. A second pending switch: reject it; do not overwrite the first command.
4. Duplicate submit request: reserve by owner and request id before any await; equal payload shares the receipt, unequal payload rejects.
5. Carrier reload: accepted data snapshots survive; current carrier can inspect and switch runs owned by the same live Agent.

The package runtime and adapter specs own coverage for these five cases.

## Task 1: Separate static strategy state and the task runtime

**Files:** `packages/experimental/task-strategy/src/runtime-types.ts`, `src/static-plan.ts`, `src/task-run.ts`, `src/executor.ts`, `src/index.ts`.

**Interfaces:** `CapturedStrategy` contains id/revision/plan. `TaskRun` exposes `start`, `requestSwitch`, `resume`, `cancel`, `inspect`. `TaskRunOptions.prepare(plan, signal)` checks a complete switch target or one proposed stage. `executeStage` shares the existing execution path and accepts retained prior results.

- [x] Add detached, content-versioned static strategy capture and an explicit cursor.
- [x] Implement one asynchronous execution pump with synchronous switch reservation and immediate cancellation.
- [x] Preflight before committing a switch; failed switching enters waiting while preserving the old binding.
- [x] Count child starts cumulatively and pass retained results into the shared stage executor.

## Task 2: Supply the original DSH lifecycle adapters

**Files:** `src/admission.ts`, `src/task-submissions.ts`, `src/cordis.ts`, `src/runtime-types.ts`.

**Interfaces:** Add host `submit(parent, request, signal)`, `inspect(parent, jobId)`, `requestSwitch(parent, jobId, request)`, and `resume(parent, jobId)`. Existing `start` also uses TaskRun. Cancellation and waiting remain original Jobs operations.

- [x] Reserve duplicate submits synchronously in a Jobs/Agent-scoped weak store; retain accepted receipts for the live owner lifetime.
- [x] Capture exact services and deployment limits for the run; avoid a disposed carrier Context in preparation callbacks.
- [x] Start work only after the synchronous Jobs registration completes; feed runtime events into existing Job logs.
- [x] Authorize control operations using Jobs ownership before looking up the run.

## Task 3: Document and compile the slice

**Files:** package README pair and pairing record; this plan's progress record.

- [x] Document implemented module responsibilities and host usage with explicit limitations.
- [x] Compile the package using its existing TypeScript project references; report any environment or pre-existing failure.
- [x] Read the final source diff, check whitespace and record changed files. Do not commit or publish.

**Evidence:** [Implementation and verification record](2026-10-09-task-strategy-runtime-progress.md).

## Execution decisions

The user's “好你试试看” authorizes implementation of the proposed slice. Work proceeds inline on `codex/task-strategy-runtime`; no further execution approval is requested. The existing untracked planning documents are preserved. This plan records implementation scope, not acceptance evidence.

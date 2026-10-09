# Task strategy binding command implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline, task by task.

**Goal:** Reject stale host switch and resume commands before author evaluation or any task-state change.

**Approved design:** The user's B framework, section 8, requires `expectedBindingEpoch` on replacement commands. The continuation request authorizes this next bounded slice on the existing `codex/task-strategy-runtime` branch. Reuse the existing execution pump, ownership checks and stage barriers.

**Architecture:** The task runtime owns the binding epoch and compares it synchronously when accepting controls. The carrier passes the caller's epoch through without substituting a fresh value. A valid command still reserves one pending switch and commits only after a drained stage. Resume is also guarded, preventing an old view from resuming a different binding. Cancellation remains the original owner-scoped Jobs operation.

**Public interfaces:** `TaskSwitch.expectedBindingEpoch: number` is required; `TaskRun.requestSwitch(load, { expectedBindingEpoch, startStage })` and `TaskRun.resume(expectedBindingEpoch)` require the observed epoch. Carrier `resume(parent, jobId, expectedBindingEpoch)` forwards it. The epoch must be a nonnegative safe integer. Mismatches throw synchronously and do not invoke the author, increment the command, change errors or wake the pump.

**Files:** `src/runtime-types.ts` describes the guarded switch; `src/task-run.ts` owns the shared guard; `src/cordis.ts` forwards caller values. Existing runtime, Loader and published-export tests and all documented consumers migrate together. The package remains experimental and opt-in.

## Task 1: Guard controls and migrate callers

- [x] Add failing source and built tests for stale switch, stale resume, invalid epoch, matching epoch and rejected-switch retry.
- [x] Observe behavioral failures before editing implementation.
- [x] Implement one runtime guard and forward the original expectation through the carrier.
- [x] Update direct runtime, host and built-test consumers; preserve explicit target cursor semantics.
- [x] Run focused source regressions, per-file coverage, compile and the published-export black-box suite.

## Task 2: Publish the input requirement and verify integration

- [x] Update README and subsystem document pairs and their pairing records; add a current-version upgrade guide.
- [x] Regenerate Cordis reference artifacts; never hand-edit generated content.
- [x] Check scoped lint, exports, upgrade guide, document links and whitespace.
- [x] Replay the existing strategy headless session to confirm unchanged model-tool behavior.
- [x] Record results and remaining B-framework scope; retain the uncommitted work.

## Observed results

The first behavioral runs reproduced accepted stale controls before the shared guard. Final direct switches use an explicit object so a legacy numeric stage argument fails TypeScript compilation. All consumers retain their intended target stage.

- Source regressions: 5 files, 109 tests passed.
- Coverage: per-file 100% statements, branches, functions and lines; totals 482 statements, 263 branches, 91 functions and 387 lines.
- Published-export black-box suite: 40 tests passed under plain Node with real Loader and Jobs composition.
- Package TypeScript compilation and runtime bundle: exit 0.
- Scoped lint, exported JSDoc, upgrade guide, four translation pairs, eight document link scans and whitespace: passed.
- Final read-only review: no actionable defects in the guard, object signature, consumers, carrier forwarding or bilingual migration instructions.
- Cordis catalog regeneration: 121 artifacts computed, 0 written after the final object migration.
- Existing headless strategy session replay: 1 passed, 138 skipped in built mode before the final direct-library object migration; that migration adds no model-tool behavior.

The package remains an opt-in experimental implementation. Durable TaskJournal/projections, native root-input routing, dynamic stage programs, UI/SDK controls and version leases remain outside this bounded slice. Work remains uncommitted.

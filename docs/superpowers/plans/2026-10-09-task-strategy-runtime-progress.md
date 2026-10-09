# Task strategy runtime implementation record

Date: 2026-10-09. Branch: `codex/task-strategy-runtime`. Base: `7667a1d2a0f4d38a56a4bf37b77661c38d9bea28`.

## Implemented scope

The first B slice keeps one owned DSH Job across captured static strategy replacements. The task retains its input, completed results and cumulative child/result limits. Active children settle and release resources before the next binding commits. Rejected replacements preserve the old binding and require an explicit resume or another replacement.

Host APIs are `submit`, `inspect`, `requestSwitch` and `resume`; cancellation and waiting use the original Jobs service. Submission reserves an owner-scoped request identity before asynchronous admission. Equal payloads share one receipt; conflicting payloads reject. Accepted runs survive carrier remount with the same module, Jobs service and exact live owner Agent.

## Module boundaries and changed files

Paths below are relative to the repository root.

| Area | Files and responsibilities |
|---|---|
| Contracts and plan data | `packages/experimental/task-strategy/src/runtime-types.ts`, `static-plan.ts`: detached bindings, host requests, task views and explicit target cursor |
| Task state | `packages/experimental/task-strategy/src/task-run.ts`: one execution pump, stage barriers, replacement, waiting and cancellation |
| Shared execution | `packages/experimental/task-strategy/src/executor.ts`: retained results use the existing child concurrency and cleanup implementation |
| Admission | `packages/experimental/task-strategy/src/admission.ts`: captured provider, preset and tool checks without retaining a carrier Context |
| Submission identity | `packages/experimental/task-strategy/src/task-submissions.ts`: canonical Jobs/Agent identity, request reservation and shared receipts |
| DSH integration | `packages/experimental/task-strategy/src/cordis.ts`, `index.ts`, `tools.ts`: original Jobs/subagent ownership and exports; existing model tool semantics retained |
| Regression coverage | `packages/experimental/task-strategy/tests/runtime.spec.ts`, `adapter.spec.ts`: state transitions and real Loader composition |
| Documentation | Package README pair and pairing record; subsystem task-strategy pair and pairing record |
| Generated API | `scripts/gen-cordis-catalog.ts` type links and generated `packages/extensions/tool-cordis/src/api-catalog.ts` |
| Work record | This record and `2026-10-09-task-strategy-runtime.md`; pre-existing untracked planning documents preserved |

## Review and fixes

A separate read-only review identified lifecycle and admission gaps. Regression cases reproduce the relevant failures, and the implementation now:

- Waits for pending author resolution before publishing terminal state.
- Rejects disposed or replaced owners, including reuse of the same session identity.
- Checks child capability admission without inflating plan bytes through synthetic names.
- Allows a queued replacement to supersede unstarted preparation even when that old preparation rejects.
- Canonicalizes preference keys using a total code-unit order.
- Shares accepted duplicate receipts independently of a follower's aborted signal.

The focused rereview reported no remaining findings. It inspected source and regression cases; command execution evidence is recorded below.

## Verification evidence

Commands ran against the existing dependency installation. The global pnpm shim points at an unavailable desktop runtime, so verification used the installed Node entrypoints directly.

| Check | Command | Observed result |
|---|---|---|
| Package tests | `node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests --reporter=dot` | 3 files, 43 tests passed |
| TypeScript build | `node node_modules/typescript/bin/tsc -b packages/experimental/task-strategy --pretty false` | Exit 0 |
| Scoped lint | `node --import tsx/esm scripts/run-oxlint.ts packages/experimental/task-strategy/src packages/experimental/task-strategy/tests` | Exit 0 |
| Export documentation | `node --import tsx/esm scripts/verify-export-jsdoc.ts` | Exit 0; every exported API name documented |
| Catalog freshness | `node --import tsx/esm scripts/gen-cordis-catalog.ts` | 121 artifacts computed, 0 written on final regeneration |
| Translation pairs | `node --import tsx/esm scripts/verify-translation-pairing.ts packages/experimental/task-strategy/README.md docs/subsystems/task-strategy.md` | Both named pairs consistent |
| Runtime bundle | From the package directory: `node ../../../node_modules/tsdown/dist/run.mjs --config tsdown.config.ts` | Build completed; three output files |
| Built export smoke | Node ESM import of built `lib/index.js` and `lib/cordis.js`; replace a gated old stage with a new plan | Four host methods present; executed `old-1`, then `new-1`; skipped `old-2`; retained two results; binding `new`; cumulative starts 2; completed |
| Whitespace | `git diff --check` | Exit 0 |

## Remaining scope

### White-box follow-up

The user's white-box request reproduced cancellation blocked by asynchronous author decisions. The user chose synchronous plan computation; `AuthorStrategy.decide`, `StrategyRegistry.decide` and replacement loaders now return plan data synchronously. The carrier retains asynchronous capability admission. The follow-up also fixes limit validation of extra options fields, preference parsing against frozen tool arguments, and failure rendering that could interrupt reservation settlement and sibling cleanup. The package now has 95 passing tests and per-file 100% statements, branches, functions and lines under the unchanged coverage thresholds. The focused compiler and lint checks pass. Evidence and the limits of the result are recorded in the [white-box report](../../../../DSH策略层白盒测试报告-2026-10-09.md); the [upgrade guide](../../upgrade-guide/v0.2.0-rc.2/task-strategy-synchronous-decisions/guide.md) covers the author API break.

This slice exposes opt-in host controls in the existing experimental package. It does not yet promote the package into the stable workflow layer or wire root input ownership and strategy selection UI. Dynamic stage decision programs, durable task events, process restart recovery and preset implementation version leases remain subsequent framework work. Limits apply to a single task; there is no global Job quota or automatic retry of side effects.

No live-provider model trial, full repository test suite, commit or publish was performed.

### Black-box follow-up

The user's black-box request adds 38 cases against published exports under plain Node, real Loader composition and the public host/tool interfaces. The first run found that blank task text could create a Job. Shared `validateTask` now rejects blank input before author evaluation or execution admission while preserving accepted text. The package has 101 passing source regressions and per-file 100% statements, branches, functions and lines. A new headless recorded-session scenario replays the model-visible errors through `dsh` in both built and source modes. The [black-box report](../../../../DSH策略层黑盒测试报告-2026-10-09.md) records scenarios, commands and limitations; the [nonblank-task upgrade guide](../../upgrade-guide/v0.2.0-rc.2/task-strategy-nonblank-tasks/guide.md) records the public input change.

### Binding-command follow-up

Host switch and resume commands now require the caller's observed binding epoch. `TaskRun` rejects invalid or mismatched expectations before author evaluation, command reservation, error changes or pump wake-up. Direct replacement accepts `{ expectedBindingEpoch, startStage }`, preventing an old numeric stage cursor from being interpreted as a version. The carrier forwards the original expectation. A rejected replacement still requires an explicit fresh decision to switch or resume. The [binding-command upgrade guide](../../upgrade-guide/v0.2.0-rc.2/task-strategy-binding-commands/guide.md) describes consumer migration.

Final evidence: 109 source tests and 40 published-export black-box tests passed. Coverage remains per-file 100% in all four dimensions, with totals of 482 statements, 263 branches, 91 functions and 387 lines. Package compilation, bundling, scoped lint, exported JSDoc, upgrade-guide validation, four bilingual pair checks, eight document link scans and whitespace passed. The final catalog regeneration computed 121 artifacts and wrote none. The existing strategy headless replay passed in built mode before the direct-library object migration. The [bounded implementation plan](2026-10-09-task-strategy-binding-commands.md) records the results and remaining framework scope.

The final read-only review found no actionable defects in the shared guard, explicit object parameter, migrated consumers, carrier forwarding or bilingual migration instructions. Review evidence is inspection only; command evidence is listed above.

# Task Strategy Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Steps use checkbox syntax for tracking.

**Goal:** Add one bounded LLM strategy-selection step above the existing task runtime, with optional user selection and a real configuration page in Plugins.

**Architecture:** The carrier resolves automatic or named selection, reserves the original request before any asynchronous work, and reuses a fresh original subagent for automatic selection. It then captures the selected synchronous author plan and enters the existing admission / Jobs / TaskRun path. The same experimental package gains an opt-in browser entry using original configuration forms and plugin slots; only catalogue reads are exposed to the browser.

**Tech Stack:** TypeScript, Cordis, original DSH subagents / Jobs / Session, Schemastery, Typert Remote generation, React and shared client UI primitives, Vitest and plain Node black-box tests.

**Spec:** [上层策略选择与插件界面设计](../specs/2026-10-09-task-strategy-selection-design.md).

## Global Constraints

- Reuse the current `codex/task-strategy-runtime` checkout and preserve all existing uncommitted changes. Do not commit or publish.
- Keep the package experimental and explicitly enabled; do not add it to stable product dependencies or shipped default profiles.
- Keep `AuthorStrategy.decide` finite and synchronous; selection is a separate asynchronous operation.
- Keep the original task text, exact live owner, original JobId, stage barriers, cumulative limits and binding-epoch guards.
- Automatic selection is the default. A caller's named choice overrides the plugin default and bypasses the selection model.
- No answer is required to use automatic mode. Optional native timed questions remain separate root-Agent calls with their original name and schema; never infer permission from timeout.
- No inherited business tools in the selector. The original child-local `structured_output` capture tool remains available when using `outputSchema`.
- Cancellation must drain selector resources before settlement. Failed selection creates no execution Job and never silently selects another strategy.
- Configuration forms save only on explicit action and retain original revision checks. UI dictionaries own Chinese and English text.
- Keep source tests and built-export tests separate. Use installed Node entrypoints; no full repository test run.

## Review Focus

1. Automatic and named requests must not collide accidentally with an author id named `auto`; hash a discriminated selection value, not a reserved strategy-name string. Task 1 pins this.
2. Two clients or duplicate tool calls must share the selection operation before the model starts, including preference dictionaries with different key ordering. Task 3 pins this.
3. An original structured child must retain only its local capture tool after inherited tools are restricted. Task 2 checks the actual request schema and denies a business tool.
4. Disposal, timeout or owner destruction between choice and admission must create no execution Job; an accepted Job must survive UI or carrier reload. Task 3 pins both sides of acceptance.
5. A stale browser catalogue or late timed-question reply must not claim a new binding or start the accepted task twice. Tasks 4 and 5 exercise refresh generations and the same original request id.

## File Map

| File | Responsibility |
|---|---|
| `packages/experimental/task-strategy/src/selection-types.ts` | Automatic / named choice, intake request and selector options |
| `src/selection.ts` | Default resolution, bounded prompt, schema and model-output parsing |
| `src/selector.ts` | One cancellable original-subagent choice operation and quiescent disposal |
| `src/task-submissions.ts` | Shared original-request reservation before either named or automatic admission |
| `src/runtime-types.ts`, `src/types.ts`, `src/schema.ts` | Receipt and configurable selector settings |
| `src/cordis.ts` | `submitTask`, lifecycle handoff, configuration snapshot and catalogue Remote read |
| `src/tools.ts` | Root-only task submission tool and optional-choice guidance |
| `src/client/index.ts`, `TaskStrategyCard.tsx`, `task-strategy-card-controller.ts`, `locales.ts`, CSS | Plugin configuration page, reactive form and catalogue reads |
| Package manifest, host/client tsconfigs and tsdown configuration | Explicit compiler faces, browser entry and generated Remote artifacts |
| Package README pairs and `docs/subsystems/task-strategy` pair | Public behavior, input requirements and opt-in UI setup |
| Current-version upgrade guide | Receipt and selector configuration migration |
| Package tests and top-level strategy-selection session snapshot | Source, built and model-visible composition evidence |

Paths beginning `src/` in this plan are relative to `packages/experimental/task-strategy/`.

### Task 1: Resolve Selection and Reserve Original Requests

**Files:** Create `src/selection-types.ts`, `src/selection.ts`, `tests/selection.spec.ts`; modify `src/runtime-types.ts`, `src/types.ts`, `src/schema.ts`, `src/task-submissions.ts`, `src/index.ts` and existing receipt consumers.

**Interfaces:**

- `TaskSelection = { readonly kind: 'auto' } | { readonly kind: 'named'; readonly strategy: string }`.
- `TaskIntakeRequest extends StrategyInput`: required `requestId`, optional `selection`.
- `SelectorOptions`: `timeoutMs`, `maxPromptBytes`, `maxOutputBytes`, `maxTokens`, optional model/provider route overrides.
- Carrier config adds `selection` containing a default `TaskSelection` and `SelectorOptions`. Schema defaults: auto, 30,000 ms, 32,768 prompt bytes, 2,048 selection-output bytes and 512 output tokens. Model/provider omission inherits the parent route. These limits govern only selection, separately from existing task execution limits.
- `resolveSelection(request: TaskIntakeRequest, fallback: TaskSelection): TaskSelection` captures an explicit mode before asynchronous work.
- `parseSelection(value: unknown, candidates: readonly string[]): string` accepts exactly one object property `strategy` belonging to the original candidate set.
- `TaskReceipt` adds required `strategy: string`; update all producers and test fixtures together and document this experimental API change.
- Extend `reserveSubmission` to accept `TaskSubmission | TaskIntakeRequest` and retain `Promise<TaskReceipt>`. Normalize direct submissions as named choices before hashing; sort preference keys as before. Resolution defaults are captured inside the first reserved operation, so replaying an accepted original request cannot change choice after configuration reload.

- [x] Write failing tests: omitted selection resolves auto; explicit named wins; author id `auto` remains a valid named strategy; empty request/task refuses before creator; same original request and reordered preferences share one promise; different mode or task under one id rejects; a failed creator releases its reservation.
- [x] Run `node node_modules/vitest/vitest.mjs run packages/experimental/task-strategy/tests/selection.spec.ts --reporter=dot`; observe behavior failures.
- [x] Implement the interfaces, single explicit default-resolution step and strict model JSON parser. Apply positive safe-integer/timer-range semantics to limits; do not add hostile-shape checks to trusted typed calls.
- [x] Run the focused tests and package TypeScript compiler. Update the source launch fixture's resolved config and existing exact receipt assertions; preserve their other expectations.

### Task 2: Execute One Bounded Selector Child

**Files:** Create `src/selector.ts`, `tests/selector.spec.ts`; extend Loader-composed `tests/adapter.spec.ts`.

**Interfaces:** `selectStrategy(parent: Agent, candidates: readonly { id: string; description: string }[], input: StrategyInput, options: SelectorOptions, subagents: Context['subagents'], executionProvider: string, signal: AbortSignal): Promise<string>`.

- [x] Write failing tests: no candidates refuses without child start; prompt bytes above the cap refuse without start; parent text remains unchanged; schema candidate enum is fixed per request; non-completed/missing/invalid output rejects; output bytes above the cap reject; success disposes the selector before returning its id.
- [x] Add real Loader cases: selector sees only the original `structured_output` capture tool, returns a schema-valid strategy, and cannot invoke a file or dispatch tool. Confirm its prompt and committed choice appear in the child Session.
- [x] Observe failures with the focused test runner.
- [x] Implement one operation using the existing provider. Preflight output-schema, tool-filter and agent-option capabilities. Pass `toolFilter: { allow: [] }`, candidate-enum `outputSchema`, bounded output tokens and parent route or configured overrides. Use one combined cancellation signal including the deadline; await result and always dispose in `finally`. Return only after cleanup and a final cancellation check.
- [x] Run focused tests for cancellation during child creation, model wait, result processing and cleanup, using actual supported provider semantics. Assert no retained selector Agent after settlement.

### Task 3: Join Selection to Existing Admission and Jobs

**Files:** Modify `src/cordis.ts`, `src/tools.ts`, `tests/adapter.spec.ts`, `tests/blackbox.mjs`, README pairs and the upgrade guide.

**Interfaces:** `TaskStrategies.submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt>`. Existing direct `submit` and plan `start` remain available. All receipts identify the captured strategy.

- [x] Add failing cases for two simultaneous automatic submissions: one selector, one author decision, one execution Job and equal receipts. Add named choice bypassing the selector, default named choice, conflicting duplicate input and unregistered choice before admission.
- [x] Add lifecycle cases: timeout, caller cancellation, carrier unload and owner destruction before acceptance create no execution Job; accepted work survives remount; a corrected failed intake retries the same id. A duplicate follower's cancellation does not cancel the first submitter's operation.
- [x] Run focused source and new built-export cases to observe failures before implementation.
- [x] Implement `submitTask` with original ownership checks, detached request, reservation before selection, captured default/options and one admission-operation controller. Only unaccepted operations belong to carrier teardown. Recheck cancellation and exact live owner after selector cleanup, decide synchronously, then call existing `startCaptured`.
- [x] Register `${prefix}_submit` on root scopes with `requestId`, `task`, optional `strategy` and string-valued preferences. A present strategy becomes a named selection; omission uses the plugin default. Output includes job id, plan name and chosen strategy. Keep existing list/plan/run tools.
- [x] Document that optional native timed questions occur independently before submitting the same request id; pending or skipped answers retain automatic mode. Late replies must never invent a new submission for the original request. No question is required by `submitTask`.
- [x] Run affected source tests, compiler and built black-box cases after rebuilding. Add bilingual migration instructions for the receipt field and explicit selector defaults.

### Task 4: Register the Actual Plugin Configuration Page

**Files:** Create `src/client/index.ts`, `src/client/TaskStrategyCard.tsx`, `src/client/task-strategy-card-controller.ts`, `src/client/locales.ts`, `src/client/TaskStrategyCard.module.css`, `src/css-modules.d.ts`, `tests/task-strategy-card.client.spec.tsx`, `tests/task-strategy-controller.client.spec.ts`; modify `src/cordis.ts`, schema/manifest/build files and compiler aggregates.

**Interfaces:** Keep browser exports to Loader `apply` / `inject` and framework-required type declarations. Use `SettingsFormModel` over the existing `experimental-task-strategy` entry, `ctx.configForms`, shared `SettingsForm`/field primitives and `plugins.item` with id `task-strategy`, label “任务策略” / “Task strategies”. Register only while that Host namespace is served.

Catalogue access: make the carrier a `TypertRemoteService` and mark only existing `catalog()` as `@Remote`; return strategies/presets, never author functions or task controls. Publish generated `./typert` and `./remote` artifacts and mount the experimental Remote contribution from the browser entry. Do not add it to stable API Remotes. Refresh catalogue on page activation, explicit retry, configuration change and connection reset; reject obsolete responses through the controller's generation. No polling or second catalogue source.

- [x] Add failing tests for default auto rendering, named-mode strategy field, unknown stored strategy display, staged edits, save/discard, revision conflict and page withdrawal when the Host namespace disappears.
- [x] Add catalogue tests for failure/retry and disconnect/reconnect while an older catalogue read is unresolved. Keep displayed names from the current accepted generation.
- [x] Implement the same layout pattern as the original AgentLoop/Subagent forms using shared primitives. Use typed dictionaries, framework hooks and an injected face; components do not receive `ctx` or subscribe to external sources.
- [x] Mark only selector preference/config fields editable through the schema's volatile fields. Preserve static plan and execution authorization configuration. Save defaults affects later intake only.
- [x] Split the package into explicit `tsconfig.host.json` / `tsconfig.client.json` leaves and a solution root. Add `/client`, `dsh.client` metadata and generated Remote exports; use the existing `clientBundle` host/client build mechanism plus package-mode Typert generation. Update aggregate leaf references and regenerate source paths.
- [x] Extend source opt-in overlay to load the browser half through the existing carrier metadata. Check that ordinary headless use does not require browser services and disabling the carrier removes the page.
- [x] Run client tests under the existing client Vitest project and compile both leaf programs. Validate the real plugin page under explicit strategy integration in Chinese and English; verify save/reload on an editable profile, and missing-service/disabled transitions in client tests. Capture page evidence and compare with the static design.

### Task 5: Prove Model and Human-Choice Composition

**Files:** Extend `tests/blackbox.mjs`, `tests/built-blackbox.e2e.ts`, `tests/snapshot-carrier.ts`; add `snapshots/session/task-strategy-selection/` using the current session snapshot layout; update package/subsystem pairs.

- [x] Add a real Loader black-box scenario using a scripted external model only: choose a registered strategy, submit once, observe actual stage execution and no retained selector child.
- [x] Compose original timed ask-user and its answerer before `${prefix}_submit`. Exercise a timely named answer, unattended pending result followed by auto submission, and late reply followed by the same original request id. Assert the pending result is not an answer or approval and the accepted execution Job count remains one.
- [x] Add published-export refusal cases for unknown selection, empty task, unsupported selector provider, cancelled selection, catalogue changed during selection and selected target that fails original preset admission.
- [x] Author a top-level keyless recorded session through the supported headless profile, retaining original question schemas/names and logged structured selector capture. Replay in source and built modes and verify original empty-input replay still matches its owned expectations.
- [x] Update public contracts and limitations together in English and Chinese; regenerate generated catalogs and translation records rather than hand-editing generated regions.

### Task 6: Focused Verification and Read-Only Review

- [x] Run package source coverage, including new selector and client files, under unchanged per-file thresholds. Run only affected checks; fix failures at their owner.
- [x] Compile package leaf programs: `node node_modules/typescript/bin/tsc -b packages/experimental/task-strategy --pretty false`.
- [x] Build package runtime/browser/Remote faces with installed tsdown, then run `node --test packages/experimental/task-strategy/tests/blackbox.mjs` under plain Node.
- [x] Replay the new named scenario through `vitest.snapshot.config.ts`; keep provider interactions scripted and keyless.
- [x] Run scoped `scripts/run-oxlint.ts`, exported JSDoc, upgrade guides, package dependency/compiler-face/client-bundle gates, affected documentation links, generators and translation pairing; finish with `git diff --check`.
- [x] Follow `superpowers:requesting-code-review` for one read-only whole-change review. Resolve lifecycle, schema, ownership, default-resolution and UI-framework findings before claiming completion.
- [x] Record observed test counts, coverage, real-page evidence, limitations and remaining framework scope. Keep changes local and uncommitted.

## Plan Self-Review

The approved spec maps to Tasks 1–3 for intake, selection and ownership; Task 4 for the actual plugin UI; Task 5 for native timed questions and durable model-visible evidence; Task 6 for verification. Optional user choice never becomes a prerequisite of automatic submission. The only clarification from source inspection is that “no tools” excludes inherited business tools while retaining the original structured-result capture mechanism. A generated experimental catalogue contribution avoids a stable dependency on this package.

User approved inline execution by repeated “继续做”. Implementation, focused source/built verification and real-page save/reload, locale and theme checks are complete. The original ConfigEditor local-path preview defect is documented and avoided with a canonical file URL; expanding scope to repair that editor awaits the user's answer. See the [progress ledger](../../../.superpowers/sdd/2026-10-09-task-strategy-selection/progress.md) for commands, review findings and limitations.

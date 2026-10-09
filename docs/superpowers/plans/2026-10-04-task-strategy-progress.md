# Execution ledger — plan: 2026-10-04-task-strategy.md

Ruling: Execute in the existing checkout on feature/task-strategy — the user explicitly requested building this source version, and the installed workspace dependencies belong here — the checkout must remain on this branch to reproduce the enhanced launch.

Ruling: Treat "就这样吧，开始构建" as approval to execute the corrected design inline — do not request another design handoff — authors may request broader workflow semantics after the initial phased executor.

Pre-flight: Task 1 exposes agentPreset to Task 3; Task 2 exposes plans and execution to Task 3. No interface conflicts.

Task 1 RED: three new preset tests fail; original five inheritance tests pass. Explicit selection still shows coding tools, selected-preset filtering fails, and unknown presets are ignored.

Task 1 GREEN: driver and subagent service tests: 112/112 pass.

Task 2 RED: nine component tests fail on unimplemented registry/executor methods after scaffolding.

Task 2 GREEN: 9/9 pass, including preferences, disposer identity, ordering, concurrency, cancellation, capacity, and failure.

Task 3 RED: Loader-composed tests fail on absent adapter tools and decisions.

Task 3 investigation: Schemastery materializes optional arrays and objects; an omitted tool filter became allow:[], hiding every child tool. Use undefined-first unions to preserve omission without adding unknown casts. The integration fixture catches this through actual model schemas.

Task 3 GREEN: Loader-composed original DSH model loop previews and dispatches a strategy, original children select reviewing/coding, and original job_output collects the result. Keyless recorded snapshots include the real upper tool results and lower outputs.

Review: independent read-only reviewer found two important boundaries: malformed later-stage tool filters admitted too late, and oversized dispatch receipts. Four RED regressions reproduced them. Preflight now leases each selected preset's tool catalog and rejects empty/unknown/reserved filters before jobs start. Receipt presentation preserves valid JSON and the usable job id within the configured byte ceiling, shortening oversized names. Smallest 512-byte and multibyte cases covered.

Verification: selected component/subagent tests 173 passing; targeted TypeScript build and runtime package bundle successful. Translation check: five pairs consistent. Type-equivalence check: 471 source blocks and paired derivatives match. Alias check and git diff --check passed. No full repository suite run.

Launch: original named-profile CLI with explicit source carrier overlay listens at 127.0.0.1:3090, process 49644. Authenticated HTML returns 200. Config dump confirms task-strategy source carrier and cautious author strategy. Codex browser open queued. Existing llm-pi-ai failed-import warning remains; live paid-model execution has not been verified.

Ruling: use the built official CLI entry with tsx loader for source overlay — the direct source bin's import.meta.main guard does not run under this Windows tsx invocation — no launcher source changes needed. Component-local tsdown must run from its package directory; root invocation with --root was invalid, corrected package-local build exits 0.

Lockfile: retained only the new workspace importer; discarded unrelated version churn produced by offline lockfile refresh. Existing user settings, default compositions, previous drafts, and other source changes preserved.

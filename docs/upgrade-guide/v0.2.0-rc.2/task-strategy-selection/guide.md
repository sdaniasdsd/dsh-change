---
kind: upgrade-guide
description: "Experimental task-strategy intake adds bounded automatic selection and identifies the chosen strategy in receipts."
---

# Task strategy selection and receipts

English | [中文](guide.zh.md)

## Change

`TaskReceipt` requires `strategy` alongside `jobId` and `name`. The opt-in carrier adds `submitTask` and `task_strategy_submit`; existing direct submission remains named. Automatic selection uses one original subagent with no inherited business tools, bounded output and a deadline. No user answer is required; failed selection rejects before creating an execution Job.

The resolved carrier configuration wraps editable `selection` fields in Cordis `Volatile` references. Raw Loader configuration remains plain data. Each new intake captures the current values once; accepted Jobs retain their execution configuration.

Submission tool receipts remain valid JSON and preserve Job/strategy ids; only a long display name is shortened. Intake rejects a JSON-encoded strategy id exceeding the carrier's `maxOutputBytes` minus 256 metadata bytes before Job acceptance. This is the carrier output limit, separate from the selector's `selection.maxOutputBytes`.

When a smaller limit after remount cannot present an old receipt, the tool reports the already accepted Job id as an explicit error. Read that Job or restore the earlier limit and repeat the original request; do not create a new request id. The full host receipt and deduplication reservation remain available.

## Migration

1. Add `strategy` to receipt producers and fixtures. Read it to identify which author decision was accepted.
2. Supply `requestId` and the original nonblank task to `submitTask`. Omit `selection` for the plugin default, use `{ kind: 'auto' }` for automatic choice, or `{ kind: 'named', strategy: 'your-id' }` to bypass the selection model. Keep the original id and input on repeated calls.
3. Configure `selection.default`, `timeoutMs`, `maxPromptBytes`, `maxOutputBytes` and `maxTokens` in the Loader. Defaults are automatic, 30,000 ms, 32,768 bytes, 2,048 bytes and 512 tokens. The plugin page edits the default mode, model/provider and deadline. Omitted model/provider inherit the parent route. Direct constructor callers use the resolved result of the carrier's `Config` schema.
4. Keep optional timed questions as original root tool calls before submission. An unanswered question retains the default; a late reply does not submit the original task again. Use the [existing binding controls](../task-strategy-binding-commands/guide.md) for an accepted task.
5. Put the opt-in carrier in the active profile patch when its UI must save defaults. A command-line strategy overlay takes precedence, so the original ConfigEditor rejects conflicting UI saves and retains the draft. See the [source trial instructions](../../../../packages/experimental/task-strategy/README.md#use-this-package).

See the [package contract](../../../../packages/experimental/task-strategy/README.md).

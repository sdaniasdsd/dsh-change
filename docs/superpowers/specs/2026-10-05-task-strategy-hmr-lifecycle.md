# Task strategy jobs across configuration reload

## Intent

Changing or removing the task-strategy carrier through configuration hot reload must stop future dispatch through the old carrier without cancelling work that DSH has already accepted as an owned Job. An accepted run keeps the execution choices it was admitted with and continues to publish progress and its terminal result through the original Jobs service. Agent disposal and Jobs-backend shutdown retain DSH's existing cancellation and drain behavior.

## Evidence and root cause

`TaskStrategies` currently owns an `active` map of controllers and promises. Its Cordis disposer sets `closing`, aborts every controller, then awaits all promises. Each controller is created inside the `jobs.start()` producer, but is registered in the strategy service's map. Disposing the strategy service during config reload therefore cancels accepted jobs even though the Jobs service owns their records.

The Jobs package contract says jobs outlive their producer/controller registrations and are cancelled when their owner Agent or Jobs backend is disposed. Task strategy's extra service-scoped cancellation conflicts with that contract. DSH HMR correctly disposes and recreates the configured service; the unwanted cancellation is introduced by the strategy adapter's disposal effect, not by HMR itself.

## Behavior

- A dispatch admitted by the current strategy service captures its validated plan, task, execution limits, provider selection, and output limit before handing execution to `ctx.jobs.start()`.
- After `jobs.start()` accepts the job, strategy-service unload must not abort it or wait for it to finish. The accepted job's closure retains only the snapshot and the stable execution dependencies it needs.
- Unloading the service immediately removes its tools and strategy registrations through normal Cordis effects. A replacement service exposes the new configuration; removed strategies cannot start new jobs, and changed strategies affect only newly admitted jobs.
- An in-progress preflight is not an accepted job. If the strategy service begins unloading before preflight completes and before `jobs.start()`, dispatch rejects rather than starting stale work.
- Disposing the owning Agent or the Jobs backend continues to cancel and drain accepted jobs under the existing DSH Jobs contract. No new persistent queue, cross-process continuation, or survival across owner/backend shutdown is introduced.
- Job progress, output, cancellation, and ownership remain implemented by the original Jobs and subagent systems.

## Implementation shape

- Remove the strategy adapter's service-owned active-job controllers and unload-time abort/drain effect.
- Retain a service-closing guard for registration and dispatch admission. Recheck it after asynchronous preflight and immediately before synchronous Jobs admission.
- Construct an immutable run snapshot before `jobs.start()`. The Job producer uses that snapshot and does not consult the strategy registry, mutable adapter configuration, or the disposed adapter instance after admission.
- Keep child cancellation linked to the Job producer's cancellation signal so `job_kill`, owner disposal, and Jobs-backend shutdown still stop children and await their cleanup.
- Do not change generic HMR or Jobs-backend lifecycle semantics.

## Verification

Add regression coverage at the Cordis adapter boundary:

1. Start a strategy Job whose child is held at a controllable promise; dispose/reload only the strategy carrier; prove the child signal remains live and the accepted Job completes with its original plan and output.
2. Mount the replacement carrier with changed or removed strategies; prove new dispatch follows the replacement configuration while the old Job completes unchanged.
3. Unload during a pending preflight; prove the call rejects and no Job or child is admitted.
4. Dispose the owning Agent or Jobs backend with an accepted run; prove normal Job cancellation still reaches the child and teardown waits for resource release.

Existing Jobs and subagent lifecycle tests remain authoritative for owner and backend teardown. Run the focused task-strategy and Jobs tests, plus the repository's required checks for the affected package and docs.

## Compatibility and limits

This changes the existing documented behavior that adapter unload cancels active strategy runs. A configuration reload will no longer be an implicit cancellation control for accepted jobs; users must use `job_kill`, dispose the owning Agent, or shut down the Jobs backend. Accepted jobs may temporarily execute code and configuration captured before reload, by design. Dependency teardown may still cancel child work if the underlying subagent/provider service itself is removed or shut down.

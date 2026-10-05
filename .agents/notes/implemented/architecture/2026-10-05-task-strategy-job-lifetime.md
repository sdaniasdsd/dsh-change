# Agent Note: Jobs own accepted task-strategy run lifetime

Status: implemented

English | [中文](2026-10-05-task-strategy-job-lifetime.zh.md)

## Problem

The task-strategy Cordis carrier used to retain each accepted Job's abort controller and promise in its own service scope. Its unload disposer cancelled and drained them. A profile configuration reload therefore killed valid work even though DSH Jobs explicitly outlive producer and controller registrations; accepted jobs are cancelled when their owning Agent or Jobs backend is disposed.

## Decision

The strategy carrier owns strategy registration, dispatch tools, and admission only. Before calling `jobs.start()`, it validates and snapshots the plan, task, provider, and run limits. After Jobs accepts the run, the producer and its children are owned by the Jobs record and its owner Agent, not by the carrier fiber. Carrier unload closes admission and removes its registrations; it neither cancels nor waits for accepted Jobs. Use `job_kill` for explicit cancellation. Agent disposal and Jobs-backend shutdown continue to cancel and drain through the existing Jobs contract.

## Alternatives considered

- **Keep cancelling runs when the carrier unloads.** Rejected: configuration reload is not an explicit cancellation request and producer reload is defined to leave Jobs alive.
- **Change generic HMR or Jobs teardown to preserve more work.** Rejected: both already expose the needed lifecycle boundary; task-strategy was introducing the extra cancellation.
- **Persist or transfer work across a Jobs-backend or process shutdown.** Rejected: Jobs are process-local, and restart recovery is outside this adapter's contract.

## Consequences

- New dispatch immediately uses the replacement configuration; accepted runs finish with their captured plan and limits.
- Existing Jobs may run concurrently with a newly loaded strategy carrier. Adapter reload no longer substitutes for `job_kill`.
- Removing the underlying subagent/provider dependencies or disposing the owning Agent or Jobs backend can still cancel the child, as defined by those owners.

## Testing

- `packages/experimental/task-strategy/tests/adapter.spec.ts` proves that unloading the carrier removes its tools while a Job remains running with an un-aborted child request; explicit `job_kill` still settles it.
- The same adapter test file proves that unloading during asynchronous preflight rejects before Job or child admission.
- `packages/jobs/jobs-local/tests/jobs.spec.ts` remains the owner and Jobs-backend cancellation authority.

/** Jobs/Agent-scoped task references and admission reservations survive carrier remounts. */
import { createHash } from 'node:crypto'
import { symbols } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { TaskReceipt, TaskSubmission } from './runtime-types.ts'
import type { TaskRun } from './task-run.ts'
import type { TaskIntakeRequest } from './selection-types.ts'
import { validateTask } from './task-input.ts'

interface OwnerRuns {
  readonly runs: Map<JobId, { readonly task: string; readonly run: TaskRun }>
  readonly requests: Map<string, { readonly digest: string; readonly receipt: Promise<TaskReceipt> }>
}

const registries = new WeakMap<JobRegistry, WeakMap<Agent, OwnerRuns>>()

/**
 * Obtain task references scoped to the exact Jobs service and live Agent.
 * @param jobs - lifecycle owner of accepted runs.
 * @param owner - exact Agent, including its composition scope.
 * @returns owner-local references; their lifetime does not retain either weak key.
 */
export function ownerRuns(jobs: JobRegistry, owner: Agent): OwnerRuns {
  // Cordis creates caller-traced wrappers; weak keys must identify the underlying service and Agent.
  const registry = (jobs as JobRegistry & { [symbols.original]?: JobRegistry })[symbols.original] ?? jobs
  const agent = (owner as Agent & { [symbols.original]?: Agent })[symbols.original] ?? owner
  let owners = registries.get(registry)
  if (owners === undefined) { owners = new WeakMap(); registries.set(registry, owners) }
  let runs = owners.get(agent)
  if (runs === undefined) { runs = { runs: new Map(), requests: new Map() }; owners.set(agent, runs) }
  return runs
}

/**
 * Reserve a submission before any asynchronous author decision or preflight.
 * @param owner - owner-local store.
 * @param request - captured request; preference key order does not change its meaning.
 * @param create - acceptance callback invoked once for this request id.
 * @returns the same receipt promise for equal requests; rejects a conflicting payload.
 */
export function reserveSubmission(
  owner: OwnerRuns, request: TaskSubmission | TaskIntakeRequest, create: () => Promise<TaskReceipt>,
): Promise<TaskReceipt> {
  if (!request.requestId.trim()) return Promise.reject(new Error('Task request id must not be empty'))
  // validateTask's same-process contract throws Error; catch bindings are typed unknown.
  // oxlint-disable-next-line unicorn/prefer-promise-reject-errors -- forward the Error raised by validateTask
  try { validateTask(request.task) } catch (error) { return Promise.reject(error) }
  const preferences = request.preferences ?? {}
  const selection = 'strategy' in request ? { kind: 'named', strategy: request.strategy }
    : request.selection === undefined ? { kind: 'default' }
      : request.selection.kind === 'auto' ? { kind: 'auto' } : { kind: 'named', strategy: request.selection.strategy }
  const digest = createHash('sha256').update(JSON.stringify({
    task: request.task, selection,
    preferences: Object.keys(preferences).sort().map(key => [key, preferences[key]]),
  })).digest('hex')
  const existing = owner.requests.get(request.requestId)
  if (existing !== undefined) {
    return existing.digest === digest ? existing.receipt : Promise.reject(new Error('Task request id was already used for different input'))
  }
  const receipt = Promise.resolve().then(create)
  const entry = { digest, receipt }
  owner.requests.set(request.requestId, entry)
  void receipt.catch(() => {
    // A rejected admission owns no Job and can be retried after its cause is corrected.
    // This handler runs before callers can retry; no other path replaces a reserved entry.
    owner.requests.delete(request.requestId)
  })
  return receipt
}

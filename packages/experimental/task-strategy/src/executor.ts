/** Phased task execution with a caller-supplied executor, not a plugin loader. */
import type { ExecutionEvent, ExecutionOptions, ExecutionPlan, ExecutionResult, TaskExecutor, TaskResult } from './types.ts'
import { errorText } from './errors.ts'
import { validateTask } from './task-input.ts'
import { taskPrompt } from './task-prompt.ts'

/**
 * Reject empty plans or limits before children start.
 * @param plan - typed author decision.
 * @param options - positive safe-integer execution limits.
 */
export function validatePlan(plan: ExecutionPlan, options: Pick<ExecutionOptions, 'maxConcurrent' | 'maxTasks' | 'maxResultBytes'>): void {
  const limits = { maxConcurrent: options.maxConcurrent, maxTasks: options.maxTasks, maxResultBytes: options.maxResultBytes }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive safe integer`)
  }
  if (!plan.name.trim() || plan.stages.length === 0) throw new Error('Execution plan must not be empty')
  let count = 0
  for (const stage of plan.stages) {
    if (!stage.name.trim() || stage.tasks.length === 0) throw new Error('Execution stage must not be empty')
    count += stage.tasks.length
    for (const step of stage.tasks) {
      if (!step.label.trim() || !step.preset.trim() || !step.instruction.trim()) throw new Error('Task fields must not be empty')
    }
  }
  if (count > options.maxTasks) throw new Error(`Execution plan exceeds task limit ${options.maxTasks}`)
}

/**
 * Execute stages with bounded concurrency and best-effort progress observers.
 * The executor owns child cleanup; a failed child aborts siblings and skips later stages.
 * @param plan - decision captured before the first await.
 * @param task - nonblank task shared with every child as user input, preserving its whitespace.
 * @param execute - cancellable executor that settles after resource release.
 * @param options - execution limits, signal, and optional observer.
 * @returns terminal report with bounded labelled child results.
 */
export async function executePlan(
  plan: ExecutionPlan, task: string, execute: TaskExecutor, options: ExecutionOptions,
): Promise<ExecutionResult> {
  return executeStages(plan, task, [], execute, options)
}

/**
 * Execute one admitted stage while retaining task-wide prior results and byte accounting.
 * @param stage - the next stage of a captured strategy.
 * @param task - unchanged task input.
 * @param prior - retained results from all previously completed strategies.
 * @param execute - executor that settles after child resource release.
 * @param options - fixed task limits, cancellation and observations.
 * @returns terminal stage report including retained prior results.
 */
export async function executeStage(
  stage: ExecutionPlan['stages'][number], task: string, prior: readonly TaskResult[],
  execute: TaskExecutor, options: ExecutionOptions,
): Promise<ExecutionResult> {
  return executeStages({ name: stage.name, stages: [stage] }, task, prior, execute, options)
}

async function executeStages(
  plan: ExecutionPlan, task: string, prior: readonly TaskResult[], execute: TaskExecutor, options: ExecutionOptions,
): Promise<ExecutionResult> {
  validateTask(task)
  const { maxConcurrent, maxTasks, maxResultBytes } = options
  validatePlan(plan, { maxConcurrent, maxTasks, maxResultBytes })
  const captured = structuredClone(plan)
  const controller = new AbortController()
  const cancelled = (): boolean => controller.signal.aborted
  const abort = (): void => { controller.abort(options.signal.reason) }
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  const results: TaskResult[] = structuredClone([...prior])
  if (Buffer.byteLength(JSON.stringify(results), 'utf8') > maxResultBytes) {
    options.signal.removeEventListener('abort', abort)
    throw new Error(`Execution exceeds result byte limit ${maxResultBytes}`)
  }
  let failure: string | undefined
  const fail = (message: string): void => {
    if (options.signal.aborted || failure !== undefined) return
    failure = message
    controller.abort(new Error(message))
  }
  const emit = (event: ExecutionEvent): void => {
    try { options.onEvent?.(event) }
    catch (error) {
      // Observation is best-effort; an observer cannot revoke execution.
      void error
    }
  }
  try {
    for (const stage of captured.stages) {
      if (controller.signal.aborted) break
      emit({ type: 'stage', stage: stage.name })
      const prior = JSON.stringify(results)
      const stageResults: (TaskResult | undefined)[] = []
      let next = 0
      const worker = async (): Promise<void> => {
        while (!cancelled()) {
          const index = next++
          const step = stage.tasks[index]
          if (step === undefined) return
          emit({ type: 'task-start', stage: stage.name, label: step.label, preset: step.preset })
          if (cancelled()) return
          const prompt = taskPrompt(task, step.instruction, prior)
          try {
            const child = await execute(step, prompt, controller.signal)
            emit({ type: 'task-end', stage: stage.name, label: step.label, stopReason: child.stopReason,
              ...child.sessionId === undefined ? {} : { sessionId: child.sessionId } })
            const row: TaskResult = { ...child, stage: stage.name, label: step.label }
            const retained = [...results, ...stageResults.filter((entry): entry is TaskResult => entry !== undefined), row]
            if (Buffer.byteLength(JSON.stringify(retained), 'utf8') > maxResultBytes) {
              fail(`Execution exceeds result byte limit ${maxResultBytes}`)
            } else stageResults[index] = row
            if (child.stopReason !== 'completed') fail(`Task ${step.label} ended with ${child.stopReason}`)
          } catch (error) {
            fail(`Task ${step.label} failed: ${errorText(error)}`)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(maxConcurrent, stage.tasks.length) }, () => worker()))
      results.push(...stageResults.filter((entry): entry is TaskResult => entry !== undefined))
    }
    if (failure !== undefined) return { status: 'failed', results, error: failure }
    if (options.signal.aborted) return { status: 'cancelled', results }
    return { status: 'completed', results }
  } finally {
    options.signal.removeEventListener('abort', abort)
  }
}

import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { captureStrategy, executePlan, StrategyRegistry, TaskRun } from '../src/index.ts'
import { executeStage, validatePlan } from '../src/executor.ts'
import { boundText, parsePreferences } from '../src/schema.ts'
import { selectStage } from '../src/static-plan.ts'
import { reserveSubmission } from '../src/task-submissions.ts'
import type { ExecutionPlan, TaskExecutor } from '../src/types.ts'
import type { TaskRunEvent, TaskRunOptions } from '../src/runtime-types.ts'

const plan: ExecutionPlan = { name: 'plan', stages: [{ name: 'work', tasks: [
  { label: 'child', preset: 'coding', instruction: 'work' },
] }] }
const options: TaskRunOptions = { maxConcurrent: 1, maxTasks: 3, maxResultBytes: 4096, prepare: async () => {} }
const complete: TaskExecutor = async () => ({ stopReason: 'completed', output: 'done' })
const capture = () => captureStrategy('policy', plan)

describe('strategy white-box lifecycle paths', () => {
  it('settles a switch reservation even when the author throws an unprintable object', async () => {
    let rejection: string | undefined
    const run = new TaskRun('task', capture(), complete, { ...options, onEvent: (event) => {
      if (event.type === 'switch-rejected') rejection = event.error
      if (event.type === 'waiting') run.resume(0)
    } })
    expect(() => run.requestSwitch(() => { throw Object.create(null) }, { expectedBindingEpoch: 0 })).not.toThrow()
    expect((await run.start()).status).toBe('completed')
    expect(rejection).toContain('Unprintable error')
    expect(run.inspect().pendingSwitch).toBeUndefined()
  })

  it('normalizes an unprintable preparation failure into a terminal report', async () => {
    const run = new TaskRun('task', capture(), complete, {
      ...options, prepare: async () => { throw Object.create(null) },
    })
    expect(await run.start()).toEqual({ status: 'failed', results: [], error: 'Unprintable error' })
  })

  it('drains siblings before reporting an unprintable child error', async () => {
    let failChild!: () => void
    let releaseSibling!: () => void
    let enterSibling!: () => void
    const failure = new Promise<void>((resolve) => { failChild = resolve })
    const release = new Promise<void>((resolve) => { releaseSibling = resolve })
    const entered = new Promise<void>((resolve) => { enterSibling = resolve })
    const controller = new AbortController()
    let siblingSignal: AbortSignal | undefined
    let settled = false
    const parallel = structuredClone(plan)
    parallel.stages[0]!.tasks.push({ label: 'sibling', preset: 'coding', instruction: 'sibling' })
    const done = executePlan(parallel, 'task', async (step, _prompt, signal) => {
      if (step.label === 'child') { await failure; throw Object.create(null) }
      siblingSignal = signal
      enterSibling()
      await release
      return { stopReason: 'aborted', output: '' }
    }, { ...options, maxConcurrent: 2, signal: controller.signal }).then(
      result => ({ result }), (error: unknown) => ({ error }),
    )
    void done.then(() => { settled = true })
    try {
      await entered
      failChild()
      await new Promise<void>((resolve) => { setImmediate(resolve) })
      expect(siblingSignal?.aborted).toBe(true)
      expect(settled).toBe(false)
      releaseSibling()
      expect(await done).toMatchObject({ result: { status: 'failed', error: 'Task child failed: Unprintable error' } })
    } finally {
      controller.abort('test cleanup')
      failChild()
      releaseSibling()
      await done
    }
  })

  it.each([-1, 0.5, 2])('rejects a target cursor outside the plan: %s', (index) => {
    expect(() => selectStage(capture(), index)).toThrow('Invalid strategy stage index')
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid command cursor before evaluating its policy: %s', (index) => {
    let decisions = 0
    const run = new TaskRun('task', capture(), complete, options)
    expect(() => run.requestSwitch(() => { decisions++; return capture() }, { expectedBindingEpoch: 0, startStage: index })).toThrow('nonnegative safe integer')
    expect(decisions).toBe(0)
    expect(run.inspect().pendingSwitch).toBeUndefined()
  })

  it('recovers from a synchronous author error by selecting another target while waiting', async () => {
    const events: TaskRunEvent[] = []
    const run = new TaskRun('task', capture(), complete, { ...options, onEvent: (event) => {
      events.push(event)
      if (event.type === 'waiting') run.requestSwitch(capture, { expectedBindingEpoch: 0 })
    } })
    run.requestSwitch(() => { throw new Error('decision unavailable') }, { expectedBindingEpoch: 0 })
    expect((await run.start()).status).toBe('completed')
    expect(events.filter(event => event.type === 'switch-committed')).toHaveLength(1)
    expect(run.inspect()).toMatchObject({ binding: { epoch: 1 }, startedTasks: 1 })
  })

  it('resumes immediately from a rejected end-of-plan target without replaying a target stage', async () => {
    const events: TaskRunEvent[] = []
    const run = new TaskRun('task', capture(), complete, { ...options, onEvent: (event) => {
      events.push(event)
      if (event.type === 'switch-rejected') run.resume(0)
    } })
    run.requestSwitch(capture, { expectedBindingEpoch: 0, startStage: 1 })
    expect((await run.start()).results.map(result => result.label)).toEqual(['child'])
    expect(run.inspect().binding.epoch).toBe(0)
    expect(events.some(event => event.type === 'waiting')).toBe(false)
  })

  it('does not dispatch a child when cancellation occurs in the binding notification', async () => {
    let starts = 0
    const run = new TaskRun('task', capture(), async (...args) => { starts++; return complete(...args) }, {
      ...options, onEvent: (event) => { if (event.type === 'switch-committed') run.cancel('cancelled at boundary') },
    })
    run.requestSwitch(capture, { expectedBindingEpoch: 0 })
    expect((await run.start()).status).toBe('cancelled')
    expect(starts).toBe(0)
    expect(run.inspect().binding.epoch).toBe(1)
  })

  it('cancels a queued task without execution and leaves terminal state unchanged on repeated cancellation', async () => {
    let starts = 0
    const run = new TaskRun('task', capture(), async (...args) => { starts++; return complete(...args) }, options)
    expect(() => { run.resume(0) }).toThrow('not waiting')
    run.cancel('queued cancellation')
    expect(() => run.requestSwitch(capture, { expectedBindingEpoch: 0 })).toThrow('stopping')
    expect((await run.start()).status).toBe('cancelled')
    run.cancel('late cancellation')
    expect(run.inspect().phase).toBe('cancelled')
    expect(starts).toBe(0)
  })

  it('fails initial preparation without starting a child or changing the binding', async () => {
    const run = new TaskRun('task', capture(), complete, {
      ...options, prepare: async () => { throw new Error('preset removed') },
    })
    expect(await run.start()).toMatchObject({ status: 'failed', error: 'Error: preset removed', results: [] })
    expect(run.inspect()).toMatchObject({ phase: 'failed', binding: { epoch: 0 }, startedTasks: 0 })
  })

  it('settles cancellation during old-stage preparation without publishing a failure', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const run = new TaskRun('task', capture(), complete, { ...options, prepare: async () => { entered(); await gate } })
    const done = run.start()
    await started
    run.cancel('cancel preparation')
    release()
    expect(await done).toEqual({ status: 'cancelled', results: [] })
  })

  it('rejects oversized retained results before attaching live child work', async () => {
    const controller = new AbortController()
    let starts = 0
    await expect(executeStage(plan.stages[0]!, 'task', [
      { stage: 'earlier', label: 'earlier', output: 'large', stopReason: 'completed' },
    ], async (...args) => { starts++; return complete(...args) }, {
      ...options, maxResultBytes: 2, signal: controller.signal,
    })).rejects.toThrow('result byte limit')
    expect(getEventListeners(controller.signal, 'abort')).toEqual([])
    expect(starts).toBe(0)
  })

  it('honors an already cancelled executor signal before the first stage', async () => {
    let starts = 0
    const result = await executePlan(plan, 'task', async (...args) => { starts++; return complete(...args) }, {
      ...options, signal: AbortSignal.abort('cancelled'),
    })
    expect(result).toEqual({ status: 'cancelled', results: [] })
    expect(starts).toBe(0)
  })

  it.each(['label', 'preset', 'instruction'] as const)('rejects an empty task %s before dispatch', (field) => {
    const invalid = structuredClone(plan)
    Object.assign(invalid.stages[0]!.tasks[0]!, { [field]: ' ' })
    expect(() => { validatePlan(invalid, options) }).toThrow('Task fields must not be empty')
  })

  it('rejects an empty author identity', () => {
    const registry = new StrategyRegistry()
    expect(() => registry.register({ id: ' ', description: 'empty', decide: () => plan })).toThrow('must not be empty')
    expect(registry.list()).toEqual([])
  })
})

describe('strategy white-box input and retention paths', () => {
  it('parses string-valued preferences and rejects malformed model JSON', () => {
    expect(parsePreferences({ speed: 'fast' })).toEqual({ speed: 'fast' })
    expect(() => parsePreferences({ speed: 2 })).toThrow()
  })

  it('truncates on a UTF-8 character boundary including the complete notice', () => {
    const notice = '\n[truncated; inspect child sessions for full output]'
    expect(boundText('abc', 3)).toBe('abc')
    expect(boundText('中'.repeat(50), Buffer.byteLength(notice) + 2)).toBe(notice)
    expect(boundText('中'.repeat(50), Buffer.byteLength(notice) + 3)).toBe('中' + notice)
    expect(boundText('中'.repeat(50), Buffer.byteLength(notice))).toBe(notice)
  })

  it('rejects empty request identity before acceptance', async () => {
    const store: Parameters<typeof reserveSubmission>[0] = { runs: new Map(), requests: new Map() }
    let starts = 0
    await expect(reserveSubmission(store, { requestId: ' ', strategy: 'policy', task: 'task' }, async () => {
      starts++
      return { jobId: JobId('unused'), name: 'plan', strategy: 'policy' }
    })).rejects.toThrow('must not be empty')
    expect(starts).toBe(0)
    expect(store.requests.size).toBe(0)
  })
})

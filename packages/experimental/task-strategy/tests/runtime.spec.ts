import { describe, expect, it } from 'vitest'
import { captureStrategy, StrategyRegistry, TaskRun } from '../src/index.ts'
import type { ExecutionPlan, TaskExecutor } from '../src/types.ts'
import type { TaskRunEvent, TaskRunOptions } from '../src/runtime-types.ts'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => { resolve = ready })
  return { promise, resolve }
}

function strategy(id: string, ...labels: string[]) {
  const plan: ExecutionPlan = { name: id, stages: labels.map(label => ({ name: label,
    tasks: [{ label, preset: 'coding', instruction: `Do ${label}` }],
  })) }
  return captureStrategy(id, plan)
}

const options: TaskRunOptions = { maxConcurrent: 2, maxTasks: 8, maxResultBytes: 4096, prepare: async () => {} }
const complete: TaskExecutor = async step => ({ stopReason: 'completed', output: `${step.label} output` })

describe('task-owned static strategy runtime', () => {
  it('rejects an empty task before creating a controllable run', () => {
    expect(() => new TaskRun(' \n\t', strategy('old', 'work'), complete, options)).toThrow('Task must not be empty')
  })
  it('captures a synchronous replacement before returning its command', async () => {
    const target = strategy('new', 'target')
    const run = new TaskRun('task', strategy('old', 'old'), complete, { ...options, onEvent: (event) => {
      if (event.type === 'waiting') run.cancel('replacement was not captured')
    } })
    run.requestSwitch(() => target, { expectedBindingEpoch: 0 })
    target.plan.stages[0]!.tasks[0] = { label: 'mutated', preset: 'coding', instruction: 'mutated' }
    expect(await run.start()).toMatchObject({ status: 'completed', results: [{ label: 'target' }] })
    expect(run.inspect().binding).toMatchObject({ id: 'new', epoch: 1 })
  })

  it('switches after cleanup and passes retained results to the target strategy', async () => {
    const started = gate()
    const release = gate()
    const calls: string[] = []
    const events: TaskRunEvent[] = []
    const run = new TaskRun('same task', strategy('old', 'research', 'old-build'), async (step, prompt) => {
      calls.push(`start:${step.label}`)
      if (step.label === 'research') { started.resolve(); await release.promise }
      else { expect(prompt).toContain('research output'); expect(prompt).toContain('same task') }
      calls.push(`released:${step.label}`)
      return { stopReason: 'completed', output: `${step.label} output` }
    }, { ...options, onEvent: (event) => {
      events.push(event)
      if (event.type === 'switch-committed') expect(calls).toEqual(['start:research', 'released:research'])
    } })
    const done = run.start()
    expect(run.start()).toBe(done)
    await started.promise
    run.requestSwitch(() => strategy('new', 'target-build'), { expectedBindingEpoch: 0 })
    expect(run.inspect().binding.id).toBe('old')
    release.resolve()
    expect((await done).results.map(row => row.label)).toEqual(['research', 'target-build'])
    expect(run.inspect()).toMatchObject({ phase: 'completed', startedTasks: 2, completedStages: 2,
      binding: { id: 'new', epoch: 1 } })
    expect(calls).not.toContain('start:old-build')
    expect(events.at(-1)).toEqual({ type: 'terminal', status: 'completed' })
    expect(() => run.requestSwitch(() => strategy('late', 'late'), { expectedBindingEpoch: 0 })).toThrow('settled')
  })

  it('drains every child of a parallel stage before committing a switch', async () => {
    const bothStarted = gate()
    const first = gate()
    const second = gate()
    const current = strategy('old', 'parallel')
    current.plan.stages[0]!.tasks.push({ label: 'second', preset: 'coding', instruction: 'second' })
    let active = 0
    const run = new TaskRun('task', current, async (step) => {
      if (step.label !== 'target') {
        if (++active === 2) bothStarted.resolve()
        await (step.label === 'second' ? second.promise : first.promise)
        active--
      } else expect(active).toBe(0)
      return { stopReason: 'completed', output: step.label }
    }, options)
    const done = run.start()
    await bothStarted.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    first.resolve()
    await first.promise
    expect(run.inspect().binding.id).toBe('old')
    second.resolve()
    expect((await done).status).toBe('completed')
  })

  it('rejects a second pending switch without evaluating its target', async () => {
    const run = new TaskRun('task', strategy('old', 'old'), complete, options)
    let loads = 0
    run.requestSwitch(() => strategy('new', 'new'), { expectedBindingEpoch: 0 })
    expect(() => run.requestSwitch(() => { loads++; return strategy('other', 'other') }, { expectedBindingEpoch: 0 })).toThrow('already pending')
    const done = run.start()
    expect((await done).results.map(row => row.label)).toEqual(['new'])
    expect(loads).toBe(0)
  })

  it('captures the target registration before a same-tick unload can remove it', async () => {
    const registry = new StrategyRegistry()
    const remove = registry.register({ id: 'target', description: 'target', decide: () => strategy('target', 'new').plan })
    const run = new TaskRun('task', strategy('old', 'old'), complete, { ...options, onEvent: (event) => {
      if (event.type === 'waiting') run.cancel('unexpected missing registration')
    } })
    run.requestSwitch(() => captureStrategy('target', registry.decide('target', { task: 'task' })), { expectedBindingEpoch: 0 })
    remove()
    expect((await run.start()).results.map(row => row.label)).toEqual(['new'])
  })

  it('admits the complete target plan before replacing the binding', async () => {
    const waiting = gate()
    const target = strategy('new', 'safe', 'disallowed')
    const run = new TaskRun('task', strategy('old', 'old'), complete, {
      ...options, prepare: async (plan) => {
        if (plan.stages.some(stage => stage.name === 'disallowed')) throw new Error('later stage disallowed')
      }, onEvent: (event) => { if (event.type === 'waiting' || event.type === 'terminal') waiting.resolve() },
    })
    run.requestSwitch(() => target, { expectedBindingEpoch: 0 })
    const done = run.start()
    await waiting.promise
    expect(run.inspect()).toMatchObject({ binding: { id: 'old', epoch: 0 }, startedTasks: 0 })
    run.cancel('done')
    expect((await done).status).toBe('cancelled')
  })

  it('keeps the old binding when target preflight fails and resumes its next stage', async () => {
    const started = gate()
    const release = gate()
    const waiting = gate()
    const run = new TaskRun('task', strategy('old', 'research', 'build'), async (step) => {
      if (step.label === 'research') { started.resolve(); await release.promise }
      return complete(step, '', new AbortController().signal)
    }, { ...options, prepare: async (plan) => { if (plan.name === 'new') throw new Error('target unavailable') },
      onEvent: (event) => { if (event.type === 'waiting') waiting.resolve() } })
    const done = run.start()
    await started.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    release.resolve()
    await waiting.promise
    expect(run.inspect()).toMatchObject({ phase: 'waiting', nextStage: 1, binding: { id: 'old', epoch: 0 } })
    run.resume(0)
    expect((await done).results.map(row => row.label)).toEqual(['research', 'build'])
  })

  it('cancels preparation without publishing the target binding or starting children', async () => {
    const preparing = gate()
    const release = gate()
    let starts = 0
    let preparationSignal: AbortSignal | undefined
    const run = new TaskRun('task', strategy('old', 'old'), async (...args) => { starts++; return complete(...args) }, {
      ...options, prepare: async (_plan, signal) => { preparationSignal = signal; preparing.resolve(); await release.promise },
    })
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    const done = run.start()
    await preparing.promise
    run.cancel(new Error('owner cancelled'))
    expect(preparationSignal!.aborted).toBe(true)
    expect(run.inspect().phase).toBe('stopping')
    release.resolve()
    expect((await done).status).toBe('cancelled')
    expect(run.inspect().binding.id).toBe('old')
    expect(starts).toBe(0)
  })

  it('waits for active child cleanup after cancellation and skips all later stages', async () => {
    const started = gate()
    const release = gate()
    let released = false
    let childSignal: AbortSignal | undefined
    const run = new TaskRun('task', strategy('old', 'first', 'later'), async (_step, _prompt, signal) => {
      childSignal = signal
      started.resolve()
      await release.promise
      released = true
      return { stopReason: 'aborted', output: '' }
    }, options)
    const done = run.start()
    await started.promise
    run.cancel('cancel')
    expect(childSignal!.aborted).toBe(true)
    expect(released).toBe(false)
    release.resolve()
    expect((await done).status).toBe('cancelled')
    expect(released).toBe(true)
    expect(run.inspect().startedTasks).toBe(1)
  })

  it('discards a captured pending switch when the current child fails', async () => {
    const started = gate()
    const child = gate()
    const run = new TaskRun('task', strategy('old', 'first'), async () => {
      started.resolve(); await child.promise
      return { stopReason: 'error', output: '' }
    }, options)
    const done = run.start()
    await started.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    child.resolve()
    expect((await done).status).toBe('failed')
    expect(run.inspect()).toMatchObject({ phase: 'failed', binding: { id: 'old', epoch: 0 }, startedTasks: 1 })
  })

  it('does not reset the cumulative child allowance after switching', async () => {
    const started = gate()
    const release = gate()
    const waiting = gate()
    const target = strategy('new', 'target')
    target.plan.stages[0]!.tasks.push({ label: 'extra', preset: 'coding', instruction: 'extra' })
    const run = new TaskRun('task', strategy('old', 'first'), async (step) => {
      started.resolve(); await release.promise
      return complete(step, '', new AbortController().signal)
    }, { ...options, maxTasks: 2, onEvent: (event) => { if (event.type === 'waiting') waiting.resolve() } })
    const done = run.start()
    await started.promise
    run.requestSwitch(() => target, { expectedBindingEpoch: 0 })
    release.resolve()
    await waiting.promise
    expect(run.inspect().error).toContain('cumulative task limit 2')
    expect(run.inspect().startedTasks).toBe(1)
    run.cancel('done')
    expect((await done).status).toBe('cancelled')
  })

  it('counts retained prior results against the same UTF-8 byte limit after switching', async () => {
    const started = gate()
    const release = gate()
    const run = new TaskRun('task', strategy('old', 'first'), async (step) => {
      if (step.label === 'first') { started.resolve(); await release.promise }
      return { stopReason: 'completed', output: '中'.repeat(35) }
    }, { ...options, maxResultBytes: 250 })
    const done = run.start()
    await started.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    release.resolve()
    const result = await done
    expect(result.status).toBe('failed')
    expect(result.error).toContain('result byte limit')
    expect(result.results.map(row => row.label)).toEqual(['first'])
  })

  it('discards an unstarted old-stage preflight when a switch arrives during it', async () => {
    const preparing = gate()
    const release = gate()
    const labels: string[] = []
    const run = new TaskRun('task', strategy('old', 'old'), async (step) => {
      labels.push(step.label); return complete(step, '', new AbortController().signal)
    }, { ...options, prepare: async (plan) => { if (plan.name === 'old') { preparing.resolve(); await release.promise } } })
    const done = run.start()
    await preparing.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    release.resolve()
    expect((await done).status).toBe('completed')
    expect(labels).toEqual(['target'])
  })

  it('processes a reserved switch when superseded old-stage preflight rejects', async () => {
    const preparing = gate()
    const release = gate()
    const run = new TaskRun('task', strategy('old', 'old'), complete, {
      ...options, prepare: async (plan) => {
        if (plan.name === 'old') { preparing.resolve(); await release.promise; throw new Error('old preset removed') }
      },
    })
    const done = run.start()
    await preparing.promise
    run.requestSwitch(() => strategy('new', 'target'), { expectedBindingEpoch: 0 })
    release.resolve()
    expect((await done).results.map(row => row.label)).toEqual(['target'])
  })

  it('uses an explicit target cursor and detaches captured plans and views', async () => {
    const old = strategy('old', 'old')
    const run = new TaskRun('task', old, complete, options)
    old.plan.stages[0]!.tasks[0] = { label: 'mutated', preset: 'coding', instruction: 'mutated' }
    run.requestSwitch(() => strategy('new', 'skip', 'selected'), { expectedBindingEpoch: 0, startStage: 1 })
    Object.assign(run.inspect().binding, { id: 'mutated' })
    expect((await run.start()).results.map(row => row.label)).toEqual(['selected'])
    expect(run.inspect().binding.id).toBe('new')
  })

  it('contains observer errors and honors cancellation from an observer before child dispatch', async () => {
    let starts = 0
    const run = new TaskRun('task', strategy('old', 'old'), async (...args) => { starts++; return complete(...args) }, {
      ...options, onEvent: (event) => {
        if (event.type === 'task-start') run.cancel('observer cancellation')
        throw new Error('observer failure')
      },
    })
    expect((await run.start()).status).toBe('cancelled')
    expect(starts).toBe(0)
    expect(run.inspect().startedTasks).toBe(0)
  })
})

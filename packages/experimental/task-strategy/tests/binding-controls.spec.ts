import { describe, expect, it } from 'vitest'
import { captureStrategy, TaskRun } from '../src/index.ts'
import type { TaskRunOptions } from '../src/runtime-types.ts'

const options: TaskRunOptions = { maxConcurrent: 2, maxTasks: 8, maxResultBytes: 4096, prepare: async () => {} }
const captured = (id: string) => captureStrategy(id, { name: id, stages: [{ name: id,
  tasks: [{ label: id, preset: 'coding', instruction: id }],
}] })
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => { resolve = ready })
  return { promise, resolve }
}

describe('binding versions on task controls', () => {
  it('rejects a stale switch before evaluating its author and accepts a refreshed expectation', async () => {
    const entered = gate(), release = gate()
    let loads = 0
    const run = new TaskRun('task', captured('old'), async (step) => {
      if (step.label === 'new') { entered.resolve(); await release.promise }
      return { stopReason: 'completed', output: step.label }
    }, options)
    run.requestSwitch(() => captured('new'), { expectedBindingEpoch: 0 })
    const done = run.start()
    try {
      await entered.promise
      const before = run.inspect()
      expect(before.binding.epoch).toBe(1)
      expect(() => run.requestSwitch(() => { loads++; return captured('latest') }, { expectedBindingEpoch: 0 })).toThrow('binding epoch changed')
      expect(loads).toBe(0)
      expect(run.inspect()).toEqual(before)
      expect(run.requestSwitch(() => { loads++; return captured('latest') }, { expectedBindingEpoch: before.binding.epoch })).toBe(2)
      release.resolve()
      expect((await done).results.map(row => row.label)).toEqual(['new', 'latest'])
      expect(run.inspect().binding).toMatchObject({ id: 'latest', epoch: 2 })
      expect(loads).toBe(1)
    } finally { release.resolve(); run.cancel('test cleanup'); await done }
  })

  it('rejects a stale resume without clearing the retained error or leaving waiting', async () => {
    const waiting = gate()
    const run = new TaskRun('task', captured('old'), async step => ({ stopReason: 'completed', output: step.label }), {
      ...options, onEvent: (event) => {
        if (event.type === 'switch-committed') run.requestSwitch(() => { throw new Error('target unavailable') }, { expectedBindingEpoch: 1 })
        if (event.type === 'waiting') waiting.resolve()
      },
    })
    run.requestSwitch(() => captured('new'), { expectedBindingEpoch: 0 })
    const done = run.start()
    try {
      await waiting.promise
      const before = run.inspect()
      expect(before).toMatchObject({ phase: 'waiting', binding: { epoch: 1 } })
      expect(before.error).toContain('target unavailable')
      expect(() => { run.resume(0) }).toThrow('binding epoch changed')
      expect(run.inspect()).toEqual(before)
      run.resume(before.binding.epoch)
      expect((await done).results.map(row => row.label)).toEqual(['new'])
    } finally { run.cancel('test cleanup'); await done }
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid expected epoch %s before reserving a command', (epoch) => {
      let loads = 0
      const run = new TaskRun('task', captured('old'), async () => ({ stopReason: 'completed', output: 'done' }), options)
      const before = run.inspect()
      expect(() => run.requestSwitch(() => { loads++; return captured('new') }, { expectedBindingEpoch: epoch })).toThrow('Binding epoch must be a nonnegative safe integer')
      expect(() => { run.resume(epoch) }).toThrow('Binding epoch must be a nonnegative safe integer')
      expect(run.inspect()).toEqual(before)
      expect(loads).toBe(0)
      expect(run.requestSwitch(() => captured('new'), { expectedBindingEpoch: 0 })).toBe(1)
    },
  )
})

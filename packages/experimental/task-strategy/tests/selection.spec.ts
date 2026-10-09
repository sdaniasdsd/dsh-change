import { describe, expect, it, vi } from 'vitest'
import { parseSelection, resolveSelection } from '../src/selection.ts'
import { ownerRuns, reserveSubmission } from '../src/task-submissions.ts'
import { Context } from '@deepseek-ai/cordis'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'

describe('task intake selection', () => {
  it('captures defaults while preserving explicit named choices', () => {
    const fallback = { kind: 'auto' as const }
    expect(resolveSelection({ requestId: 'r', task: 'task' }, fallback)).toEqual(fallback)
    expect(resolveSelection({ requestId: 'r', task: 'task', selection: { kind: 'named', strategy: 'auto' } }, fallback))
      .toEqual({ kind: 'named', strategy: 'auto' })
  })
  it.each([null, [], 'auto', {}, { strategy: 1 }, { strategy: 'missing' }, { strategy: 'auto', extra: true }])
  ('refuses invalid model output %j', (value) => { expect(() => parseSelection(value, ['auto'])).toThrow('Invalid strategy selection') })
  it('accepts only the captured catalogue', () => { expect(parseSelection({ strategy: 'auto' }, ['auto'])).toBe('auto') })

  it('reserves before creation, distinguishes modes and releases failed intake', async () => {
    const ctx = new Context()
    await ctx.plugin(Jobs)
    const owner = { id: 'owner' } as Agent
    const store = ownerRuns(ctx.jobs, owner)
    const receipt = { jobId: JobId('strategy-1'), name: 'name', strategy: 'auto' }
    const create = vi.fn(async () => receipt)
    try {
      const first = reserveSubmission(store, { requestId: 'r', task: 'task', preferences: { b: '2', a: '1' } }, create)
      expect(reserveSubmission(store, { requestId: 'r', task: 'task', preferences: { a: '1', b: '2' } }, create)).toBe(first)
      await expect(first).resolves.toEqual(receipt)
      expect(create).toHaveBeenCalledTimes(1)
      await expect(reserveSubmission(store, { requestId: 'r', task: 'task', selection: { kind: 'auto' } }, create)).rejects.toThrow('different input')
      await expect(reserveSubmission(store, { requestId: 'r', task: 'other' }, create)).rejects.toThrow('different input')
      const named = reserveSubmission(store, { requestId: 'n', task: 'task', strategy: 'auto' }, create)
      expect(reserveSubmission(store, { requestId: 'n', task: 'task', selection: { kind: 'named', strategy: 'auto' } }, create)).toBe(named)
      await expect(reserveSubmission(store, { requestId: 'n', task: 'task', selection: { kind: 'auto' } }, create)).rejects.toThrow('different input')
      await expect(reserveSubmission(store, { requestId: 'bad', task: 'task' }, async () => { throw new Error('failed') })).rejects.toThrow('failed')
      await expect(reserveSubmission(store, { requestId: 'bad', task: 'task' }, create)).resolves.toEqual(receipt)
      await expect(reserveSubmission(store, { requestId: ' ', task: 'task' }, create)).rejects.toThrow('request id')
      await expect(reserveSubmission(store, { requestId: 'empty', task: ' ' }, create)).rejects.toThrow('Task must not be empty')
      expect(create).toHaveBeenCalledTimes(3)
    } finally { await ctx.fiber.dispose() }
  })
})

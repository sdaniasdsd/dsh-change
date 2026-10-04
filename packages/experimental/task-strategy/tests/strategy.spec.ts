import { describe, expect, it } from 'vitest'
import { StrategyRegistry, executePlan, validatePlan } from '../src/index.ts'
import type { ExecutionPlan } from '../src/index.ts'
import { parsePlan } from '../src/schema.ts'

function plan(labels: string[]): ExecutionPlan {
  return {
    name: 'test plan',
    stages: [{ name: 'work', tasks: labels.map(label => ({ label, preset: 'standard', instruction: `Do ${label}` })) }],
  }
}

describe('StrategyRegistry', () => {
  it('rejects blank and duplicate strategy ids', () => {
    const registry = new StrategyRegistry()
    expect(() => registry.register({ id: '  ', description: '', decide: () => plan(['a']) })).toThrow()
    registry.register({ id: 'review', description: 'Review first', decide: () => plan(['a']) })
    expect(() => registry.register({ id: 'review', description: 'Duplicate', decide: () => plan(['b']) })).toThrow()
  })

  it('passes and returns detached snapshots when deciding', async () => {
    const registry = new StrategyRegistry()
    const decision = plan(['implement'])
    let received: { task: string; preferences: { speed: string } } | undefined
    registry.register({
      id: 'implement', description: 'Implement', decide(input) {
        received = input
        return decision
      },
    })
    const input = { task: 'Fix the build', preferences: { speed: 'fast' } }
    const result = await registry.decide('implement', input)
    expect(received).not.toBe(input)
    expect(received?.preferences).not.toBe(input.preferences)
    expect(result).not.toBe(decision)
    Reflect.set(result.stages[0]!.tasks[0]!, 'label', 'caller mutation')
    expect(decision.stages[0]!.tasks[0]!.label).toBe('implement')
  })

  it('rejects decisions for unknown strategies', async () => {
    await expect(new StrategyRegistry().decide('missing', { task: 'Do work', preferences: {} })).rejects.toThrow(/Unknown strategy/u)
  })
})

describe('execution plans', () => {
  it('rejects malformed untrusted plan data', () => {
    expect(parsePlan(plan(['one']))).toEqual(plan(['one']))
    expect(() => parsePlan({ name: 'work', stages: [{ name: 'implement', tasks: [{ label: 'one', preset: 'standard' }] }] })).toThrow()
    expect(() => validatePlan({ name: '', stages: [] }, { maxConcurrent: 1, maxTasks: 1, maxResultBytes: 1024 })).toThrow()
  })

  it('validates task count before any executor is called', () => {
    expect(() => validatePlan(plan(['one', 'two']), { maxConcurrent: 2, maxTasks: 1, maxResultBytes: 1024 })).toThrow()
  })

  it('runs tasks in a stage concurrently and does not start the next stage early', async () => {
    const execution: ExecutionPlan = {
      name: 'inspect then implement',
      stages: [
        { name: 'inspect', tasks: ['architecture', 'risks'].map(label => ({ label, preset: 'standard', instruction: label })) },
        { name: 'implement', tasks: [{ label: 'implement', preset: 'standard', instruction: 'implement' }] },
      ],
    }
    const timeline: string[] = []
    let active = 0
    let peak = 0
    const result = await executePlan(execution, 'Fix the build', async (step) => {
      active++
      peak = Math.max(peak, active)
      timeline.push(`start:${step.label}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      timeline.push(`end:${step.label}`)
      active--
      return { sessionId: step.label, stopReason: 'completed', output: step.label }
    }, { maxConcurrent: 2, maxTasks: 3, maxResultBytes: 1024, signal: new AbortController().signal })
    expect(result.status).toBe('completed')
    expect(peak).toBe(2)
    expect(timeline.indexOf('end:architecture')).toBeLessThan(timeline.indexOf('start:implement'))
    expect(timeline.indexOf('end:risks')).toBeLessThan(timeline.indexOf('start:implement'))
  })

  it('honors cancellation while a child executor is running', async () => {
    const controller = new AbortController()
    const execution = executePlan(plan(['slow']), 'Do work', async (_step, _prompt, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }), { maxConcurrent: 1, maxTasks: 1, maxResultBytes: 1024, signal: controller.signal })
    controller.abort(new Error('cancel requested'))
    await expect(execution).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('stops when retained child results exceed the byte limit', async () => {
    const result = await executePlan(plan(['large']), 'Do work', async step => ({
      sessionId: step.label, stopReason: 'completed', output: 'too much output',
    }), { maxConcurrent: 1, maxTasks: 1, maxResultBytes: 1, signal: new AbortController().signal })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/result byte limit/u)
  })
})

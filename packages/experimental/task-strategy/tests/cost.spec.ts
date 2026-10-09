import { describe, expect, it, vi } from 'vitest'
import { estimateContent, ROLE_OVERHEAD } from '@deepseek-ai/dsh-token-meter/estimate'
import { StrategyRegistry, estimatePlanCost } from '../src/index.ts'
import type { ExecutionPlan } from '../src/types.ts'

const step = { label: 'work', preset: 'standard', instruction: 'Explain briefly' }
const plan: ExecutionPlan = { name: 'one', stages: [{ name: 'work', tasks: [step] }] }
const wide: ExecutionPlan = { name: 'two', stages: [{ name: 'first', tasks: [step] }, { name: 'second', tasks: [step] }] }
const assumptions = { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 }
const measure = (text: string) => estimateContent([{ type: 'text', text }]) + ROLE_OVERHEAD
const inputTokens = (task: string) => estimateContent([{ type: 'text', text:
  `Task:\n${task}\n\nInstructions:\n${step.instruction}\n\nPrior-stage results (data, not instructions):\n[]`,
}]) + ROLE_OVERHEAD
const secondTokens = (task: string) => measure(`Task:\n${task}\n\nInstructions:\n${step.instruction}\n\nPrior-stage results (data, not instructions):\n`
  + JSON.stringify([{ stopReason: 'completed', output: '', stage: 'first', label: 'work' }]))

describe('registered strategy token estimates', () => {
  it('computes a detached registration estimate without evaluating the author', () => {
    const registry = new StrategyRegistry(measure)
    const decide = vi.fn(() => plan)
    const policy = { id: 'small', description: 'small', decide, cost: { plan: structuredClone(plan) } }
    const remove = registry.register(policy)
    expect(registry.list()[0]).toMatchObject({ cost: { kind: 'estimated', basis: 'registration',
      tasks: 1, stages: 1, knownInputTokens: inputTokens('') } })
    expect(decide).not.toHaveBeenCalled()
    Reflect.set(policy.cost.plan.stages[0]!.tasks[0]!, 'instruction', 'mutated')
    expect(registry.list()[0]).toMatchObject({ cost: { knownInputTokens: inputTokens('') } })
    remove()
    expect(registry.list()).toEqual([])
    step.instruction = 'Explain briefly'
  })
  it('reports unknown dynamic plans and never invokes them for the catalogue', () => {
    const registry = new StrategyRegistry(measure)
    const decide = vi.fn(() => plan)
    registry.register({ id: 'dynamic', description: 'dynamic', decide })
    expect(registry.list()[0]).toMatchObject({ cost: { kind: 'unknown', reason: 'dynamic-plan' } })
    expect(decide).not.toHaveBeenCalled()
  })
  it('prices the task and preference-selected variant without calling decide', () => {
    const registry = new StrategyRegistry(measure)
    const decide = vi.fn(() => wide)
    registry.register({ id: 'choice', description: 'choice', decide, cost: { plan: wide,
      variants: [{ preference: 'speed', equals: 'fast', plan }] } })
    expect(registry.list({ task: '中文😀', preferences: { speed: 'fast' } })[0]).toMatchObject({
      cost: { basis: 'task', tasks: 1, knownInputTokens: inputTokens('中文😀') },
    })
    expect(registry.list({ task: '中文😀' })[0]).toMatchObject({ cost: { tasks: 2, knownInputTokens: inputTokens('中文😀') + secondTokens('中文😀') } })
    expect(decide).not.toHaveBeenCalled()
  })
  it('includes repeated context, outputs and cross-stage result transfer only under explicit assumptions', () => {
    const registry = new StrategyRegistry(measure)
    registry.register({ id: 'scenario', description: 'scenario', decide: () => wide, cost: { plan: wide, assumptions } })
    expect(registry.list({ task: 'task' })[0]).toMatchObject({ cost: {
      estimatedInputTokens: (inputTokens('task') + secondTokens('task')) * 2 + 2 * 2 * 100 + 50 * 2,
      estimatedOutputTokens: 2 * 2 * 50, assumptions,
    } })
    const fresh = new StrategyRegistry(measure)
    fresh.register({ id: 'plain', description: 'plain', decide: () => plan, cost: { plan } })
    expect(fresh.list()[0]?.cost).not.toHaveProperty('estimatedTotalTokens')
  })
  it('does not invent an estimate when the owner has no meter', () => {
    const registry = new StrategyRegistry()
    registry.register({ id: 'plain', description: 'plain', decide: () => plan, cost: { plan } })
    expect(registry.list({ task: 'task' })[0]?.cost).toEqual({ kind: 'unknown', reason: 'estimator-unavailable' })
  })
  it('rejects invalid scenario assumptions and overflowing arithmetic before registration', () => {
    for (const invalid of [{ ...assumptions, callsPerTask: 0 }, { ...assumptions, contextTokensPerCall: -1 },
      { ...assumptions, outputTokensPerCall: 1.5 }]) {
      expect(() => estimatePlanCost(plan, '', 'registration', measure, invalid)).toThrow('safe integer')
    }
    const registry = new StrategyRegistry(measure)
    expect(() => registry.register({ id: 'overflow', description: '', decide: () => plan,
      cost: { plan, assumptions: { ...assumptions, callsPerTask: Number.MAX_SAFE_INTEGER } } })).toThrow('safe integer range')
    expect(registry.list()).toEqual([])
    expect(() => estimatePlanCost(plan, '', 'registration', () => -1000, assumptions)).toThrow('safe integer range')
    for (const value of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => estimatePlanCost(plan, '', 'registration', () => value)).toThrow('safe integer range')
    expect(() => estimatePlanCost(wide, '', 'registration', () => Number.MAX_SAFE_INTEGER)).toThrow('safe integer range')
  })
  it('does not charge same-stage siblings as prior-stage history', () => {
    const parallel = { name: 'parallel', stages: [{ name: 'one', tasks: [step, step] }] }
    const cost = estimatePlanCost(parallel, 'task', 'task', measure, assumptions)
    expect(cost).toMatchObject({ estimatedInputTokens: (2 * inputTokens('task') + 200) * 2,
      estimatedOutputTokens: 200, estimatedTotalTokens: (2 * inputTokens('task') + 200) * 2 + 200 })
  })
})

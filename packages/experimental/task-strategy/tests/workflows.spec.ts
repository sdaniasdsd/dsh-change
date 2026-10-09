import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { estimateContent, ROLE_OVERHEAD } from '@deepseek-ai/dsh-token-meter/estimate'
import { adapterSchema } from '../src/schema.ts'
import { StrategyRegistry } from '../src/index.ts'
import type { AdapterConfig } from '../src/types.ts'

describe('configurable workflow library', () => {
  it('registers all four domains at three tiers and estimates every task without executing it', async () => {
    const yaml = await readFile(new URL('../../../../strategies/workflows.patch.yml', import.meta.url), 'utf8')
    const document = parse(yaml) as { insert: { config: AdapterConfig }[] }[]
    const config = adapterSchema(structuredClone(document[0]!.insert[0]!.config))
    const registry = new StrategyRegistry(text => estimateContent([{ type: 'text', text }]) + ROLE_OVERHEAD)
    let decisions = 0
    for (const policy of config.strategies) registry.register({ id: policy.id, description: policy.description,
      cost: { plan: policy.plan, assumptions: policy.tokenCost }, decide: () => { decisions++; return policy.plan } })
    expect(registry.list()).toHaveLength(12)
    for (const domain of ['coding', 'paper-research', 'problem-research', 'solution-planning']) {
      for (const [tier, tasks] of [['low', 1], ['medium', 3], ['high', 6]] as const) {
        const policy = registry.list({ task: 'Task' }).find(row => row.id === `${domain}-${tier}`)!
        expect(policy.cost).toMatchObject({ kind: 'estimated', basis: 'task', tasks, stages: tasks })
        if (policy.cost.kind !== 'estimated') throw new Error('Expected an estimate')
        expect(policy.cost.estimatedTotalTokens).toBeGreaterThan(policy.cost.knownInputTokens)
        expect(policy.cost.unknowns).toContain('selector-and-parent')
      }
    }
    expect(decisions).toBe(0)
    expect(config.maxConcurrent).toBe(1)
  })
  it.each([
    { callsPerTask: 0, contextTokensPerCall: 0, outputTokensPerCall: 0 },
    { callsPerTask: 1, contextTokensPerCall: -1, outputTokensPerCall: 0 },
    { callsPerTask: 1, contextTokensPerCall: 0 },
  ])('rejects malformed external scenario configuration: %j', (tokenCost) => {
    expect(() => adapterSchema({ allowedPresets: ['standard'], strategies: [{ id: 'bad', description: 'bad', tokenCost,
      plan: { name: 'bad', stages: [] } }] } as AdapterConfig)).toThrow()
  })
})

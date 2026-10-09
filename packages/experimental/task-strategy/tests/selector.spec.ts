import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { selectStrategy } from '../src/selector.ts'

const options = { timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
const candidates = [{ id: 'auto', description: '策略' }]
const parent = {} as Agent
function bench(result: SubagentResult = { stopReason: 'completed', output: [], structured: { strategy: 'auto' } }) {
  const dispose = vi.fn<() => Promise<void>>(async () => {})
  const run: SubagentRun = { id: SessionId('choice'), result: Promise.resolve(result), dispose }
  const provider: SubagentProvider = { name: 'spawn', capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: async () => run }
  const start = vi.fn(async (_name: string, _request: SubagentStartRequest) => run)
  const getProvider = vi.fn(() => provider)
  const subagents = { start, getProvider } as Context['subagents']
  return { run, provider, subagents, start, getProvider, dispose }
}
describe('bounded selector operation', () => {
  it('keeps the candidate enum, task, route and token bounds and awaits cleanup', async () => {
    const b = bench()
    const cleanup = Promise.withResolvers<undefined>()
    b.dispose.mockReturnValue(cleanup.promise)
    const signal = new AbortController().signal
    let settled = false
    const selected = selectStrategy(parent, candidates, { task: '  原文\n', preferences: { speed: 'fast' } }, { ...options, model: 'model', provider: 'route' }, b.subagents, 'spawn', signal)
    void selected.then(() => { settled = true })
    await vi.waitFor(() => { expect(b.dispose).toHaveBeenCalledOnce() })
    expect(settled).toBe(false)
    expect(b.start.mock.calls[0]![1]).toMatchObject({ toolFilter: { allow: [] }, agentOptions: { model: 'model', provider: 'route', maxTokens: 512 },
      outputSchema: { properties: { strategy: { enum: ['auto'] } }, additionalProperties: false },
    })
    const prompt = b.start.mock.calls[0]![1].prompt[0]!
    expect(prompt.type === 'text' && prompt.text).toContain('  原文')
    cleanup.resolve(undefined)
    await expect(selected).resolves.toBe('auto')
  })
  it('passes task-specific cost evidence to the logged selector prompt', async () => {
    const b = bench()
    const cost = { kind: 'estimated' as const, basis: 'task' as const, planName: 'Plan', tasks: 2,
      stages: 2, knownInputTokens: 123, unknowns: ['model-turns' as const] }
    await selectStrategy(parent, [{ ...candidates[0]!, cost }], { task: 'task' }, options, b.subagents, 'spawn', new AbortController().signal)
    const prompt = b.start.mock.calls[0]![1].prompt[0]!
    expect(prompt.type === 'text' && prompt.text).toContain(JSON.stringify(cost))
    expect(prompt.type === 'text' && prompt.text).toContain('unknown')
  })
  it.each([
    { stopReason: 'aborted', output: [] }, { stopReason: 'completed', output: [] },
    { stopReason: 'completed', output: [], structured: { strategy: 'missing' } },
  ] as SubagentResult[])('refuses incomplete or invalid output and still disposes: %j', async (result) => {
    const b = bench(result)
    await expect(selectStrategy(parent, candidates, { task: 'task' }, options, b.subagents, 'spawn', new AbortController().signal)).rejects.toThrow()
    expect(b.dispose).toHaveBeenCalledOnce()
  })
  it('cancels during cleanup and checks the complete UTF-8 result bound', async () => {
    const b = bench()
    const controller = new AbortController()
    b.dispose.mockImplementation(async () => { controller.abort(new Error('during cleanup')) })
    await expect(selectStrategy(parent, candidates, { task: 'task' }, options, b.subagents, 'spawn', controller.signal)).rejects.toThrow('during cleanup')
    const bounded = bench()
    await expect(selectStrategy(parent, candidates, { task: 'task' }, { ...options, maxOutputBytes: 1 }, bounded.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('output exceeds byte limit')
    expect(bounded.dispose).toHaveBeenCalledOnce()
  })
  it('refuses pre-cancelled, no-candidate, oversize and unsupported requests before starting', async () => {
    const b = bench()
    const controller = new AbortController()
    controller.abort(new Error('before start'))
    await expect(selectStrategy(parent, candidates, { task: 'task' }, options, b.subagents, 'spawn', controller.signal)).rejects.toThrow('before start')
    await expect(selectStrategy(parent, [], { task: 'task' }, options, b.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('No strategies')
    await expect(selectStrategy(parent, candidates, { task: 'task' }, { ...options, maxPromptBytes: 1 }, b.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('prompt exceeds byte limit')
    for (const capability of ['outputSchema', 'toolFilter', 'agentOptions'] as const) {
      b.getProvider.mockReturnValue({ ...b.provider, capabilities: { ...b.provider.capabilities, [capability]: false } })
      await expect(selectStrategy(parent, candidates, { task: 'task' }, options, b.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('capabilities')
    }
    expect(b.start).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context, symbols } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import * as AskUser from '@deepseek-ai/dsh-tool-ask-user'
import Adapter from '../src/cordis.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { AdapterConfig, ExecutionPlan, ExecutionResult } from '../src/types.ts'
import { strategyTools } from '../src/tools.ts'
import { ownerRuns } from '../src/task-submissions.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function boot(
  script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('risks found'), textResponse('implemented')],
  configureModel?: (model: MockAdapter) => void,
  adapterConfig?: Partial<AdapterConfig>,
  nativeQuestions = false,
) {
  const ctx = new Context()
  contexts.push(ctx)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-task-strategy-'))
  directories.push(directory)
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), directory, { recursive: true })
  const baseUrl = pathToFileURL(directory).href + '/'
  await ctx.plugin(Loader, { baseUrl })
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, 'agent-loop': AgentLoop, subagents: Subagents, spawn: Spawn,
    jobs: Jobs, 'tool-jobs': ToolJobs, presets: Presets, preset: Preset, 'strategy-adapter': Adapter,
    questions: UserQuestions, 'ask-user': AskUser,
    'token-meter': TokenMeter,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  if (nativeQuestions) {
    await ctx.loader.create({ name: 'cordis:include', config: { path: './questions.yml' } })
    await ctx.loader.await()
  }
  if (adapterConfig !== undefined) {
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await entry.fiber!.dispose()
    entry.options.config = { ...entry.options.config as AdapterConfig, ...adapterConfig }
    await entry.init()
    await ctx.loader.await()
  }
  const model = new MockAdapter(script)
  configureModel?.(model)
  ctx.llm.registerAdapter(['mock'], model)
  const handle = await ctx.agents.create({
    sessionId: SessionId('strategy-parent'), agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  return { ctx, model, parent: handle.agent, handle }
}

describe('Loader-composed strategy adapter', () => {
  it('publishes registration and task-specific costs without running children', async () => {
    const { ctx, parent, model } = await boot()
    expect(ctx.taskStrategies.catalog().strategies[0]?.cost).toMatchObject({ kind: 'estimated', basis: 'registration', tasks: 2 })
    const result = await ctx.tools.execute({ callId: ToolCallId('cost-list'), name: 'task_strategy_list',
      arguments: { task: 'Explain token costs', preferences: { speed: 'fast' } }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    const catalog = JSON.parse(text) as ReturnType<Adapter['catalog']>
    expect(catalog.strategies[0]?.cost).toMatchObject({ kind: 'estimated', basis: 'task', tasks: 2 })
    expect(model.requests).toHaveLength(0)
    const plain = await ctx.tools.execute({ callId: ToolCallId('cost-task'), name: 'task_strategy_list',
      arguments: { task: 'Explain token costs' }, agent: parent, signal: new AbortController().signal })
    expect(plain.isError).toBe(false)
    const invalid = await ctx.tools.execute({ callId: ToolCallId('cost-no-task'), name: 'task_strategy_list',
      arguments: { preferences: { speed: 'fast' } }, agent: parent, signal: new AbortController().signal })
    expect(invalid.isError).toBe(true)
    expect(ctx.jobs.list(parent.id)).toHaveLength(0)
  })
  it('loads explicit scenario assumptions and costs configured preference variants', async () => {
    const plan: ExecutionPlan = { name: 'fast', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'Complete briefly' },
    ] }] }
    const { ctx, model } = await boot(undefined, undefined, { strategies: [{ id: 'choice', description: 'choice', plan,
      tokenCost: { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 },
      variants: [{ preference: 'speed', equals: 'fast', plan }],
    }] })
    expect(ctx.taskStrategies.list({ task: 'task', preferences: { speed: 'fast' } })[0]?.cost).toMatchObject({
      kind: 'estimated', basis: 'task', tasks: 1, estimatedOutputTokens: 100,
    })
    expect(model.requests).toHaveLength(0)
  })
  it.each(['auto', 'named'] as const)('preserves submission identity with a long name for %s intake', async (kind) => {
    const script = [textResponse('risks'), textResponse('done')]
    if (kind === 'auto') script.unshift(toolCallResponse('choose', 'structured_output', { strategy: 'long-name' }))
    const { ctx, parent } = await boot(script, undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id: 'long-name', description: 'Long display name', decide: () => ({ ...plan, name: '策略'.repeat(600) }) })
    const result = await ctx.tools.execute({ callId: ToolCallId('long-submit'), name: 'task_strategy_submit',
      arguments: { requestId: 'long-submit', task: 'task', ...kind === 'named' ? { strategy: 'long-name' } : {} },
      agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(JSON.parse(text)).toMatchObject({ jobId: 'strategy-1', strategy: 'long-name' })
    expect((await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)).status).toBe('completed')
  })

  it.each(['auto', 'named'] as const)('rejects an oversized %s strategy identity before accepting a Job', async (kind) => {
    const id = '策'.repeat(300)
    const { ctx, parent } = await boot([toolCallResponse('choose', 'structured_output', { strategy: id })], undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id, description: 'Oversized identity', decide: () => { decisions++; return plan } })
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'oversized', task: 'task',
      ...kind === 'named' ? { selection: { kind: 'named', strategy: id } as const } : {},
    }, new AbortController().signal)).rejects.toThrow('receipt byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(decisions).toBe(0)
    expect(ctx.agents.list()).toHaveLength(1)
  })

  it.each(['x'.repeat(254), '\\'.repeat(127), '中'.repeat(84) + 'ab'])('accepts exactly budgeted JSON strategy identities: %j', async (id) => {
    const { ctx, parent } = await boot(undefined, undefined, { maxOutputBytes: 512 })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id, description: 'Boundary identity', decide: () => ({ ...plan, name: '中'.repeat(600) }) })
    expect(Buffer.byteLength(JSON.stringify(id))).toBe(256)
    const result = await ctx.tools.execute({ callId: ToolCallId('boundary-id'), name: 'task_strategy_submit',
      arguments: { requestId: 'boundary-id', task: 'task', strategy: id }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(JSON.parse(text)).toMatchObject({ strategy: id, jobId: 'strategy-1' })
    expect((await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)).status).toBe('completed')
  })

  it('keeps accepted request identity when a remount makes its receipt too large for the tool', async () => {
    const { ctx, parent } = await boot()
    const id = 'x'.repeat(600)
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id, description: 'Previously accepted identity', decide: () => plan })
    const request = { requestId: 'retained-large-receipt', task: 'task', selection: { kind: 'named', strategy: id } as const }
    const receipt = await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await entry.fiber!.dispose()
    entry.options.config = { ...entry.options.config as AdapterConfig, maxOutputBytes: 512 }
    await entry.init()
    await ctx.loader.await()
    const result = await ctx.tools.execute({ callId: ToolCallId('small-receipt-replay'), name: 'task_strategy_submit',
      arguments: { requestId: request.requestId, task: request.task, strategy: id }, agent: parent, signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(result.isError).toBe(true)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512)
    expect(text).toContain('already accepted')
    expect(text).toContain(receipt.jobId)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).toEqual(receipt)
  })

  it('captures both selector routes and author preferences through the submit tool', async () => {
    const { ctx, parent, model } = await boot([toolCallResponse('choose', 'structured_output', { strategy: 'review-first' }), textResponse('risks'), textResponse('done')], undefined, {
      selection: { default: { kind: 'auto' }, model: 'mock', provider: 'mock', timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 },
    })
    const receipt = await ctx.tools.execute({ callId: ToolCallId('auto-submit'), name: 'task_strategy_submit', arguments: { requestId: 'tool-auto', task: 'task', preferences: { goal: 'safe' } }, agent: parent, signal: new AbortController().signal })
    expect(receipt.isError).not.toBe(true)
    expect(model.requests[0]!.provider).toBe('mock')
    expect(model.requests[0]!.model).toBe('mock')
    await ctx.jobs.wait(ctx.jobs.list(parent.id)[0]!.id, 5000, parent.id)
    const submitTool = strategyTools(ctx.taskStrategies, 'task_strategy', 4096).find(tool => tool.name === 'task_strategy_submit')!
    await expect(submitTool.execute({ requestId: 'no-agent', task: 'task' }, { signal: new AbortController().signal } as never)).rejects.toThrow('calling agent')
  })
  it('rejects an intake reserved immediately before carrier disposal', async () => {
    const { ctx, parent } = await boot()
    const pending = ctx.taskStrategies.submitTask(parent, { requestId: 'queued-intake', task: 'task' }, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('closing')
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    await rejected
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })
  it('rejects host inspection through a disposed owner before accessing Jobs', async () => {
    const { ctx, parent, handle } = await boot()
    const carrier = ctx.taskStrategies
    const receipt = await carrier.submit(parent, { requestId: 'inspect-owner', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await handle.dispose()
    expect(() => carrier.inspect(parent, receipt.jobId)).toThrow('exact live owner')
  })
  it.each(['answered', 'pending'] as const)('composes native timed questions with %s intake without duplicate execution on late replies', async (kind) => {
    let rootStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 18 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') {
        return request.tools?.some(tool => tool.name === 'structured_output')
          ? toolCallResponse('selection-result', 'structured_output', { strategy: 'review-first' }) : textResponse('done')
      }
      switch (rootStep++) {
        case 0: return toolCallResponse('strategy-choice', 'ask_user_question', { timeout: 1,
          questions: [{ id: 'strategy', question: 'Choose a task strategy, or let the task choose automatically.', options: [{ label: 'review-first' }] }],
        })
        case 1: return toolCallResponse('submit-original', 'task_strategy_submit', { requestId: 'original-task', task: 'task', ...kind === 'answered' ? { strategy: 'review-first' } : {} })
        case 2: return toolCallResponse('wait-original', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        case 4: return toolCallResponse('late-replay', 'task_strategy_submit', { requestId: 'original-task', task: 'task' })
        default: return textResponse('Task execution remains accepted once.')
      }
    })
    const { ctx, parent } = await boot(script, undefined, undefined, true)
    const requestListener = kind === 'answered' ? ctx.on('user-questions/request', async () => ({ answers: [{ id: 'strategy', selected: ['review-first'] }] }))
      : ctx.on('user-questions/request', async request => await new Promise((_resolve, reject) => {
        request.signal!.addEventListener('abort', () => { reject(new Error('question deadline')) }, { once: true })
      }))
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'Run task with an optional strategy choice.' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const events = parent.session.snapshotEvents()
    const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    const askResult = results.find(message => message.source.callId === 'strategy-choice')!
    expect(askResult.isError).toBe(false)
    if (kind === 'pending') {
      expect(JSON.parse(askResult.content.filter(block => block.type === 'text').map(block => block.text).join(''))).toMatchObject({ pending: true, callId: 'strategy-choice' })
      const liveParent = ctx.agents.get(parent.id)!
      expect(ctx.userQuestions.answer(liveParent, ToolCallId('strategy-choice'), { answers: [{ id: 'strategy', selected: ['review-first'] }] })).toBe(true)
      await liveParent.whenIdle()
      expect(liveParent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'user-question-reply')).toBe(true)
    }
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(ctx.jobs.list(parent.id)[0]!.status).toBe('completed')
    expect(ctx.agents.list()).toHaveLength(1)
    requestListener()
  })
  it('reads live defaults for later intake and retains accepted receipts across carrier remount', async () => {
    const { ctx, parent, model } = await boot([textResponse('risks'), textResponse('done')])
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    const config = entry.fiber!.config as ReturnType<typeof Adapter.Config>
    const { updateVolatile, createVolatile } = await import('@deepseek-ai/cosmokit')
    updateVolatile(config.selection.default, createVolatile({ kind: 'named', strategy: 'review-first' }))
    const request = { requestId: 'saved-default', task: 'task' }
    const receipt = await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests).toHaveLength(2)
    await entry.fiber!.dispose()
    await entry.init()
    await ctx.loader.await()
    expect(await ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).toEqual(receipt)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })

  it('rejects a choice removed during selection and allows retry after correction', async () => {
    const { ctx, parent } = await boot([
      toolCallResponse('choice', 'structured_output', { strategy: 'temporary' }),
      textResponse('done'),
    ])
    const unregister = ctx.taskStrategies.register({ id: 'temporary', description: 'temporary', decide: () => ({
      name: 'temporary', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }],
    }) })
    const release = ctx.on('subagent/end', () => { unregister() })
    const request = { requestId: 'gone', task: 'task' }
    await expect(ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)).rejects.toThrow('Unknown strategy: temporary')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    release()
    ctx.taskStrategies.register({ id: 'temporary', description: 'temporary', decide: () => ({
      name: 'temporary', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }],
    }) })
    const receipt = await ctx.taskStrategies.submitTask(parent, { ...request, selection: { kind: 'named', strategy: 'temporary' } }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('refuses unsupported selection providers and empty candidate sets without starting a child', async () => {
    const { ctx, parent, model } = await boot()
    const provider = ctx.subagents.getProvider('spawn')!
    const dispose = ctx.subagents.registerProvider({ ...provider, name: 'unsupported-selector', capabilities: { ...provider.capabilities, outputSchema: false } })
    const { selectStrategy } = await import('../src/selector.ts')
    const options = { timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
    await expect(selectStrategy(parent, [], { task: 'task' }, options, ctx.subagents, 'spawn', new AbortController().signal)).rejects.toThrow('No strategies')
    await expect(selectStrategy(parent, ctx.taskStrategies.list(), { task: 'task' }, options, ctx.subagents, 'unsupported-selector', new AbortController().signal))
      .rejects.toThrow('capabilities')
    dispose()
    expect(model.requests).toEqual([])
  })

  it('reports missing structured output and rejects business tools inside the selector', async () => {
    const { ctx, parent, model } = await boot([
      textResponse('review-first'),
      toolCallResponse('forbidden', 'coding_only', {}),
      toolCallResponse('valid-choice', 'structured_output', { strategy: 'review-first' }),
      textResponse('risks'), textResponse('done'),
    ])
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'missing-result', task: 'task' }, new AbortController().signal))
      .rejects.toThrow('did not complete')
    const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'correct-choice', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests.slice(0, 3).every(request => request.tools?.map(tool => tool.name).join(',') === 'structured_output')).toBe(true)
    expect(JSON.stringify(model.requests[2]!.messages)).toContain('coding_only')
  })

  it('keeps first-submitter ownership when a duplicate follower cancels', async () => {
    const { ctx, parent } = await boot([toolCallResponse('choice', 'structured_output', { strategy: 'review-first' }), textResponse('risks'), textResponse('done')])
    const request = { requestId: 'follower', task: 'task' }
    const first = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    const follower = new AbortController()
    const second = ctx.taskStrategies.submitTask(parent, request, follower.signal)
    follower.abort()
    expect(second).toBe(first)
    const receipt = await second
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })
  it('selects once before admission and retains only structured capture tools', async () => {
    const { ctx, parent, model } = await boot([
      toolCallResponse('choice', 'structured_output', { strategy: 'review-first' }),
      textResponse('risks found'), textResponse('implemented'),
    ])
    const request = { requestId: 'automatic', task: '  修复问题\n', preferences: { b: '2', a: '1' } }
    const first = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    const second = ctx.taskStrategies.submitTask(parent, { ...request, preferences: { a: '1', b: '2' } }, new AbortController().signal)
    expect(first).toBe(second)
    const receipt = await first
    expect(receipt.strategy).toBe('review-first')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(model.requests).toHaveLength(3)
    expect(model.requests[0]!.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    expect(JSON.stringify(model.requests[0]!.messages)).toContain('  修复问题')
    expect(ctx.agents.list()).toHaveLength(1)
    const replay = ctx.taskStrategies.submitTask(parent, request, new AbortController().signal)
    expect(replay).toBe(first)
  })

  it('bypasses the selection model for a named choice', async () => {
    const { ctx, parent, model } = await boot()
    const receipt = await ctx.taskStrategies.submitTask(parent,
      { requestId: 'named', task: 'task', selection: { kind: 'named', strategy: 'review-first' } }, new AbortController().signal)
    expect(receipt.strategy).toBe('review-first')
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    expect(model.requests).toHaveLength(2)
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'named', task: 'task' }, new AbortController().signal))
      .rejects.toThrow('different input')
  })

  it.each(['timeout', 'caller', 'unload', 'owner'] as const)('drains selection on %s without accepting a Job', async (kind) => {
    const { ctx, parent, model, handle } = await boot(['hang-slow'])
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    if (kind === 'timeout') {
      await entry.fiber!.dispose()
      entry.options.config = { ...entry.options.config as AdapterConfig, selection: {
        default: { kind: 'auto' }, timeoutMs: 80, maxTokens: 512, maxPromptBytes: 32768, maxOutputBytes: 2048,
      } }
      await entry.init()
      await ctx.loader.await()
    }
    const controller = new AbortController()
    const pending = ctx.taskStrategies.submitTask(parent, { requestId: kind, task: 'task' }, controller.signal)
    const rejection = expect(pending).rejects.toThrow()
    await expect.poll(() => model.requests.length).toBe(1)
    if (kind === 'caller') controller.abort(new Error('cancelled'))
    if (kind === 'unload') await entry.fiber!.dispose()
    if (kind === 'owner') await handle.dispose()
    await rejection
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toEqual([])
  })

  it.each([
    { maxPromptBytes: 1 }, { maxOutputBytes: 1 },
  ])('refuses selector byte limits without task admission: %j', async (limits) => {
    const { ctx, parent } = await boot([toolCallResponse('choice', 'structured_output', { strategy: 'review-first' })], undefined, {
      selection: { default: { kind: 'auto' }, timeoutMs: 30000, maxTokens: 512, maxPromptBytes: 32768, maxOutputBytes: 2048, ...limits },
    })
    await expect(ctx.taskStrategies.submitTask(parent, { requestId: 'bounded', task: 'task' }, new AbortController().signal)).rejects.toThrow('byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(ctx.agents.list()).toHaveLength(1)
  })
  it('forwards the callers binding epoch and rejects stale host controls before author evaluation', async () => {
    let entered!: () => void, release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, parent } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'counted', description: 'counted', decide: () => {
      decisions++
      return { name: 'counted', stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'coding', instruction: 'work' }] }] }
    } })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'guarded', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    try {
      await started
      const before = ctx.taskStrategies.inspect(parent, receipt.jobId)
      expect(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId,
        { strategy: 'counted', expectedBindingEpoch: before.binding.epoch + 1 })).toThrow('binding epoch changed')
      expect(decisions).toBe(0)
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId)).toEqual(before)
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'missing', expectedBindingEpoch: before.binding.epoch })
      release()
      await expect.poll(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      expect(() => { ctx.taskStrategies.resume(parent, receipt.jobId, 1) }).toThrow('binding epoch changed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      ctx.taskStrategies.resume(parent, receipt.jobId, before.binding.epoch)
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    } finally { release(); ctx.jobs.kill(receipt.jobId, parent.id) }
  })
  it('rejects an empty host task before reserving a Job', async () => {
    const { ctx, parent, model } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    await expect(ctx.taskStrategies.start(parent, ' \n\t', plan, new AbortController().signal)).rejects.toThrow('Task must not be empty')
    await expect(ctx.taskStrategies.submit(parent,
      { requestId: 'empty-task', strategy: 'review-first', task: '' }, new AbortController().signal)).rejects.toThrow('Task must not be empty')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('records rejection of an empty tool task and allows the model to correct it', async () => {
    let upperStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 10 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') return textResponse('implemented')
      switch (upperStep++) {
        case 0: return toolCallResponse('empty-task', 'task_strategy_run', { strategy: 'review-first', task: ' \n\t' })
        case 1: return toolCallResponse('corrected-task', 'task_strategy_run', { strategy: 'review-first', task: 'fix bug' })
        case 2: return toolCallResponse('collect', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        default: return textResponse('Corrected the task and collected results')
      }
    })
    const { ctx, parent } = await boot(script)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix bug using review-first' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const messages = parent.session.snapshotEvents().filter(event => event.type === 'tool/result').map(event => event.data.message)
    const rejection = messages.find(message => message.source.callId === 'empty-task')!
    expect(rejection.isError).toBe(true)
    expect(rejection.content).toEqual([{ type: 'text', text: 'Error: Task must not be empty' }])
    expect({ content: rejection.content, isError: rejection.isError }).toMatchSnapshot('recorded empty-task rejection')
    expect(messages.find(message => message.source.callId === 'corrected-task')!.isError).toBe(false)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect(ctx.jobs.list(parent.id)[0]!.status).toBe('completed')
  })
  it('cancels an owned Job through original Jobs without requiring a reason', async () => {
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const { ctx, parent } = await boot(['hang'], (adapter) => {
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (request) { entered(); yield* stream(request) }
    })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'cancel-no-reason', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await started
    expect(ctx.jobs.kill(receipt.jobId, parent.id)).toBe('requested')
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('killed')
    expect(ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('cancelled')
  })

  it.each([{ maxTasks: Number.MAX_SAFE_INTEGER + 1 }, { provider: ' ' }, { toolPrefix: ' ' }])('rejects invalid deployment semantics at carrier load: %j', async (config) => {
    const { ctx } = await boot(undefined, undefined, config)
    expect(ctx.get('taskStrategies')).toBeUndefined()
  })

  it('rejects a queued submission when its carrier starts closing before acceptance', async () => {
    const { ctx, parent, model } = await boot()
    const carrier = ctx.taskStrategies
    const closing = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    const pending = carrier.submit(parent, { requestId: 'queued-close', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('closing')
    await closing
    await rejection
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects inspecting a Job that was not started by the task runtime', async () => {
    const { ctx, parent } = await boot()
    const job = ctx.jobs.start({ kind: 'strategy', label: 'external', owner: parent.id,
      run: () => ({ cancel: () => {}, done: Promise.resolve({ status: 'completed' }) }),
    })
    expect(() => ctx.taskStrategies.inspect(parent, job)).toThrow('Unknown task run')
    await ctx.jobs.wait(job, 5000, parent.id)
  })

  it('resumes through the host API after a failed target capture without replaying completed children', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, parent, model } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'host-resume', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    try {
      await started
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'missing', preferences: { speed: 'fast' } })
      release()
      await expect.poll(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase).toBe('waiting')
      ctx.taskStrategies.resume(parent, receipt.jobId, 0)
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId).results.map(result => result.label)).toEqual(['inspect', 'implement'])
      expect(model.requests).toHaveLength(2)
    } finally { release(); ctx.jobs.kill(receipt.jobId, parent.id) }
  })

  it.each([{ model: 'mock' }, { provider: 'mock' }])('routes either model option without requiring its other half: %j', async (route) => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'route', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', tools: { deny: [] }, ...route },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests[0]?.model).toBe('mock')
    expect(model.requests[0]?.tools?.map(tool => tool.name)).toEqual(['coding_only', 'job_kill', 'job_list', 'job_output'])
  })

  it('records executor failure in both task state and original Job outcome', async () => {
    const { ctx, parent } = await boot([textResponse('incomplete')])
    const plan: ExecutionPlan = { name: 'bounded', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work' },
    ] }] }
    const carrierEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!
    await carrierEntry.fiber!.dispose()
    carrierEntry.options.config = { ...carrierEntry.options.config as AdapterConfig, maxResultBytes: 2 }
    await carrierEntry.init()
    await ctx.loader.await()
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('failed')
    expect(ctx.taskStrategies.inspect(parent, job).error).toContain('result byte limit')
    expect(ctx.jobs.get(job, parent.id).detail).toContain('result byte limit')
  })

  it('canonicalizes traced and original service identities into the same owner store', async () => {
    const { ctx, parent } = await boot()
    const jobs = (ctx.jobs as typeof ctx.jobs & { [symbols.original]: typeof ctx.jobs })[symbols.original]
    expect(ownerRuns(jobs!, parent)).toBe(ownerRuns(ctx.jobs, parent))
  })

  it('selects a configured variant only for matching author preferences', async () => {
    const base: ExecutionPlan = { name: 'base', stages: [{ name: 'base', tasks: [
      { label: 'base', preset: 'coding', instruction: 'base' },
    ] }] }
    const variant: ExecutionPlan = { name: 'fast', stages: [{ name: 'fast', tasks: [
      { label: 'fast', preset: 'coding', instruction: 'fast' },
    ] }] }
    const { ctx } = await boot(undefined, undefined, { strategies: [{ id: 'variant', description: 'variant', plan: base,
      variants: [{ preference: 'speed', equals: 'fast', plan: variant }],
    }] })
    expect(await ctx.taskStrategies.decide('variant', { task: 'task', preferences: { speed: 'fast' } })).toEqual(variant)
    expect(await ctx.taskStrategies.decide('variant', { task: 'task', preferences: { speed: 'slow' } })).toEqual(base)
    expect(await ctx.taskStrategies.decide('variant', { task: 'task' })).toEqual(base)
  })

  it.each([
    { capability: 'agentPreset', step: {}, error: 'preset-selecting' },
    { capability: 'toolFilter', step: { tools: { allow: [] } }, error: 'tool restrictions' },
    { capability: 'agentOptions', step: { model: 'mock' }, error: 'model selection' },
    { capability: 'agentOptions', step: { provider: 'mock' }, error: 'model selection' },
  ])('rejects unsupported child capability $capability before accepting a Job', async ({ capability, step, error }) => {
    const { ctx, parent, model } = await boot()
    Object.assign(ctx.subagents.getProvider('spawn')!.capabilities, { [capability]: false })
    const plan: ExecutionPlan = { name: 'capability', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', ...step },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow(error)
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects a broken preset before child publication', async () => {
    const { ctx, parent, model } = await boot()
    const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'ef9a660d')!
    await entry.fiber!.dispose()
    const unregister = await ctx.agentPresets.register({ id: 'reviewing', plugins: [{ name: 'cordis:missing-strategy-preset' }] })
    try {
      await expect(ctx.taskStrategies.decide('review-first', { task: 'task' })).rejects.toThrow('Invalid strategy preset')
      expect(ctx.jobs.list(parent.id)).toEqual([])
      expect(model.requests).toHaveLength(0)
    } finally { await unregister() }
  })

  it('rejects a complete plan beyond its captured byte limit', async () => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'large', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: '中'.repeat(3000) },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow('plan exceeds byte limit')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('routes explicit model, provider and both tool filters to original children', async () => {
    const { ctx, parent, model } = await boot()
    const plan: ExecutionPlan = { name: 'routed', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'coding', instruction: 'work', model: 'mock', provider: 'mock',
        tools: { allow: ['coding_only'], deny: [] } },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests[0]).toMatchObject({ model: 'mock', tools: [{ name: 'coding_only' }] })
  })

  it('validates preferences through preview and named dispatch tools', async () => {
    const { ctx, parent } = await boot()
    const preview = await ctx.tools.execute({ callId: ToolCallId('preferences-preview'), name: 'task_strategy_plan',
      arguments: { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } }, agent: parent,
      signal: new AbortController().signal })
    expect(preview, JSON.stringify(preview.content)).toMatchObject({ isError: false })
    const receipt = await ctx.tools.execute({ callId: ToolCallId('preferences-run'), name: 'task_strategy_run',
      arguments: { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } }, agent: parent,
      signal: new AbortController().signal })
    expect(receipt.isError).toBe(false)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
  })

  it.each([{}, { strategy: 'review-first', plan: { name: 'unused', stages: [] } }])('rejects ambiguous dispatch without creating a Job: %j', async (selection) => {
    const { ctx, parent, model } = await boot()
    const result = await ctx.tools.execute({ callId: ToolCallId('ambiguous'), name: 'task_strategy_run',
      arguments: { task: 'task', ...selection }, agent: parent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('exactly one')
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
  })

  it('rejects dispatch without a calling Agent', async () => {
    const { ctx, model } = await boot()
    ctx.tools.register(strategyTools(ctx.taskStrategies, 'global_strategy', 4096).find(tool => tool.name === 'global_strategy_run')!)
    const result = await ctx.tools.execute({ callId: ToolCallId('no-agent'), name: 'global_strategy_run',
      arguments: { task: 'task', strategy: 'review-first' }, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('calling agent')
    expect(model.requests).toHaveLength(0)
  })

  it('refuses new registrations and work through an unloaded carrier', async () => {
    const { ctx, parent } = await boot()
    const carrier = ctx.taskStrategies
    const plan = await carrier.decide('review-first', { task: 'task' })
    const receipt = await carrier.submit(parent, { requestId: 'closed', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(() => carrier.register({ id: 'late', description: 'late', decide: () => plan })).toThrow('closing')
    await expect(carrier.submit(parent, { requestId: 'late', strategy: 'review-first', task: 'task' }, new AbortController().signal)).rejects.toThrow('closing')
    await expect(carrier.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow('closing')
    expect(() => carrier.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'late' })).toThrow('closing')
  })

  it('releases cancelled admission without evaluating a synchronous author decision', async () => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'sync-admission', description: 'Synchronous admission', decide: () => {
      decisions++
      return plan
    } })
    const controller = new AbortController()
    const pending = ctx.taskStrategies.submit(parent,
      { requestId: 'sync-admission', strategy: 'sync-admission', task: 'task' }, controller.signal)
    controller.abort(new Error('admission cancelled'))
    await expect(pending).rejects.toThrow('admission cancelled')
    expect(decisions).toBe(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(0)
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'sync-admission', strategy: 'sync-admission', task: 'task' }, new AbortController().signal)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
    expect(decisions).toBe(1)
  })

  it('settles owner teardown after capturing a synchronous switch and aborting its child', async () => {
    let entered!: () => void
    const childStarted = new Promise<void>((resolve) => { entered = resolve })
    const { ctx, model, parent, handle } = await boot(['hang'], (adapter) => {
      const stream = adapter.stream.bind(adapter)
      adapter.stream = async function* (request) {
        entered()
        yield* stream(request)
      }
    })
    const target = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let decisions = 0
    ctx.taskStrategies.register({ id: 'sync-switch', description: 'Synchronous switch', decide: () => {
      decisions++
      return target
    } })
    const receipt = await ctx.taskStrategies.submit(parent,
      { requestId: 'sync-switch-task', strategy: 'review-first', task: 'task' }, new AbortController().signal)
    await childStarted
    ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'sync-switch' })
    expect(decisions).toBe(1)
    await handle.dispose()
    expect(ctx.jobs.list(parent.id)).toEqual([])
    expect(model.requests).toHaveLength(1)
  })

  it('rejects a stale owner after asynchronous preflight even if its session id is reused', async () => {
    const { ctx, model, parent, handle } = await boot()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    ctx.taskStrategies.register({ id: 'delayed', description: 'delayed', decide: () => plan })
    const resolvePreset = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    ctx.agentPresets.resolve = async (name) => { entered(); await gate; return resolvePreset(name) }
    const pending = ctx.taskStrategies.submit(parent, { requestId: 'stale', strategy: 'delayed', task: 'task' }, new AbortController().signal)
    const rejection = expect(pending).rejects.toThrow('live owner')
    try {
      await started
      await handle.dispose()
      const replacement = await ctx.agents.create({ sessionId: parent.id, agentOptions: { provider: 'mock', model: 'mock' } })
      release()
      await rejection
      expect(ctx.jobs.list(replacement.agent.id)).toEqual([])
      expect(model.requests).toHaveLength(0)
    } finally {
      release()
      ctx.agentPresets.resolve = resolvePreset
    }
  })

  it('refuses an accepted duplicate receipt from a disposed owner', async () => {
    const { ctx, parent, handle } = await boot()
    const request = { requestId: 'disposed', strategy: 'review-first', task: 'task' }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    await ctx.jobs.wait(receipt.jobId, 5000, parent.id)
    await handle.dispose()
    await expect(ctx.taskStrategies.submit(parent, request, new AbortController().signal)).rejects.toThrow('live owner')
  })

  it('rechecks child capabilities without inflating the admitted plan byte count', async () => {
    const { ctx, model, parent } = await boot()
    const plan: ExecutionPlan = { name: 'x', stages: [{ name: 'x', tasks: [
      { label: 'x'.repeat(3000), preset: 'coding', instruction: 'work' },
    ] }] }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests).toHaveLength(1)
  })

  it('reserves equal concurrent submits before resolving author decisions', async () => {
    const { ctx, parent } = await boot()
    expect(typeof ctx.taskStrategies.submit).toBe('function')
    const request = { requestId: 'same-request', strategy: 'review-first', task: 'task' }
    const first = ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    const second = ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    expect(first).toBe(second)
    const receipt = await first
    expect(await second).toEqual(receipt)
    const cancelledDuplicate = new AbortController()
    cancelledDuplicate.abort()
    expect(await ctx.taskStrategies.submit(parent, request, cancelledDuplicate.signal)).toEqual(receipt)
    await expect(ctx.taskStrategies.submit(parent, { ...request, task: 'different' }, new AbortController().signal)).rejects.toThrow('different')
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('deduplicates preference dictionaries independently of Unicode key insertion order', async () => {
    const { ctx, parent } = await boot()
    const request = { requestId: 'unicode', strategy: 'review-first', task: 'task', preferences: { '\u00e9': 'one', 'e\u0301': 'two' } }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    const repeated = await ctx.taskStrategies.submit(parent, { ...request, preferences: { 'e\u0301': 'two', '\u00e9': 'one' } },
      new AbortController().signal)
    expect(repeated).toEqual(receipt)
    expect(ctx.jobs.list(parent.id)).toHaveLength(1)
    expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
  })

  it('switches an accepted run after carrier reload while retaining the Job and prior results', async () => {
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { ctx, model, parent } = await boot(undefined, (adapter) => {
      const stream = adapter.stream.bind(adapter)
      let first = true
      adapter.stream = async function* (request) {
        if (first) { first = false; entered(); await gate }
        yield* stream(request)
      }
    })
    expect(typeof ctx.taskStrategies.submit).toBe('function')
    const request = { requestId: 'reload-request', strategy: 'review-first', task: 'task' }
    const receipt = await ctx.taskStrategies.submit(parent, request, new AbortController().signal)
    await started
    try {
      const entry = [...ctx.loader.entries()].find(row => row.options.id === 'task-strategy')!
      await entry.fiber!.dispose()
      await entry.init()
      await ctx.loader.await()
      ctx.taskStrategies.register({ id: 'replacement', description: 'target', decide: () => ({ name: 'replacement', stages: [
        { name: 'deliver', tasks: [{ label: 'deliver', preset: 'coding', instruction: 'Use previous findings' }] },
      ] }) })
      expect((await ctx.taskStrategies.submit(parent, request, new AbortController().signal)).jobId).toBe(receipt.jobId)
      ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'replacement' })
      release()
      expect((await ctx.jobs.wait(receipt.jobId, 5000, parent.id)).status).toBe('completed')
      expect(ctx.taskStrategies.inspect(parent, receipt.jobId)).toMatchObject({ phase: 'completed', binding: { id: 'replacement', epoch: 1 } })
      expect(model.requests).toHaveLength(2)
      expect(JSON.stringify(model.requests[1]!.messages)).toContain('risks found')
      expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
    } finally { release() }
  }, 30_000)

  it('records upper model decisions and original job collection without an API key', async () => {
    let upperStep = 0
    const script: ConstructorParameters<typeof MockAdapter>[0] = Array.from({ length: 10 }, () => (request) => {
      if (request.sessionId !== 'strategy-parent') {
        return textResponse(request.tools?.some(tool => tool.name === 'reviewing_only') ? 'risks found' : 'implemented')
      }
      switch (upperStep++) {
        case 0: return toolCallResponse('preview', 'task_strategy_plan', { strategy: 'review-first', task: 'fix bug' })
        case 1: return toolCallResponse('dispatch', 'task_strategy_run', { strategy: 'review-first', task: 'fix bug' })
        case 2: return toolCallResponse('collect', 'job_output', { job_id: 'strategy-1', wait: true, timeout_ms: 5000 })
        default: return textResponse('Collected the lower tasks')
      }
    })
    const { ctx, parent } = await boot(script)
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix bug using my review-first strategy' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const events = parent.session.snapshotEvents()
    const toolResults = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    const decisionResults = toolResults.filter(message => ['preview', 'dispatch'].includes(message.source.callId))
      .map(message => ({ callId: message.source.callId, content: message.content, isError: message.isError }))
    expect(decisionResults).toMatchSnapshot('recorded upper strategy decisions')
    expect(JSON.stringify(toolResults.filter(message => message.source.callId === 'collect'))).toContain('implemented')
    expect(ctx.jobs.get('strategy-1' as import('@deepseek-ai/dsh-jobs').JobId, parent.id).status).toBe('completed')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  })

  it('runs original DSH children with independent presets and progress', async () => {
    const { ctx, model, parent } = await boot()
    const decision = await ctx.taskStrategies.decide('review-first', { task: 'fix the bug' })
    const children: { preset: string | undefined; tools: string[] }[] = []
    ctx.on('subagent/start', (info) => {
      const child = ctx.agents.get(info.id)!
      children.push({ preset: child.session.header.agentPreset, tools: ctx.tools.schemas(child).map(tool => tool.name) })
    })
    expect(decision).toMatchSnapshot('model-visible execution plan')
    const jobId = await ctx.taskStrategies.start(parent, 'fix the bug', decision, new AbortController().signal)
    const terminal = await ctx.jobs.wait(jobId, 5000, parent.id)
    expect(terminal.status).toBe('completed')
    expect(model.requests.map(request => request.tools?.map(tool => tool.name).filter(name => name.endsWith('_only')))).toEqual([
      ['reviewing_only'], ['coding_only'],
    ])
    expect(children.map(child => child.preset)).toEqual(['reviewing', 'coding'])
    expect(children.flatMap(child => child.tools).filter(name => name.startsWith('task_strategy_'))).toEqual([])
    expect(JSON.stringify(model.requests[1]?.messages)).toContain('risks found')
    const output = ctx.jobs.read(jobId, parent.id)
    expect(output.chunks.map(chunk => chunk.text).join('')).toContain('reviewing')
    const report = JSON.parse(output.result!) as ExecutionResult
    expect(report.results.map((row: { label: string; output: string }) => ({ label: row.label, output: row.output })))
      .toMatchSnapshot('model-visible execution result')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  })

  it('exposes upper decision tools without exposing them to lower children', async () => {
    const { ctx, parent } = await boot()
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).toContain('task_strategy_run')
    const value = await ctx.tools.execute({ callId: ToolCallId('strategy-list'), name: 'task_strategy_list', arguments: {},
      agent: parent, signal: new AbortController().signal })
    expect(value.isError).toBe(false)
    const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('')
    const catalog = JSON.parse(text) as ReturnType<Adapter['catalog']>
    expect(catalog.strategies)
      .toEqual(ctx.taskStrategies.list())
    expect(catalog.presets)
      .toEqual(['coding', 'reviewing'])
  })

  it('rejects unauthorized presets before any child starts', async () => {
    const { ctx, model, parent } = await boot()
    const invalid: ExecutionPlan = { name: 'bad', stages: [{ name: 'work', tasks: [
      { label: 'work', preset: 'not-allowed', instruction: 'work' },
    ] }] }
    await expect(ctx.taskStrategies.start(parent, 'task', invalid, new AbortController().signal)).rejects.toThrow('not allowed')
    expect(model.requests).toHaveLength(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })

  it('keeps accepted jobs alive when the strategy adapter unloads', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    let childSignal: AbortSignal | undefined
    const { ctx, parent } = await boot(['hang'], (model) => {
      const stream = model.stream.bind(model)
      model.stream = async function* (options) {
        childSignal = options.signal
        requestStarted()
        yield* stream(options)
      }
    })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const jobId = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    await started
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).not.toContain('task_strategy_run')
    expect(childSignal!.aborted).toBe(false)
    expect(ctx.jobs.list(parent.id)).toEqual([expect.objectContaining({ id: jobId, status: 'running' })])
  }, 30_000)

  it('keeps accepted jobs cancellable after the strategy adapter unloads', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    let childSignal: AbortSignal | undefined
    const { ctx, parent } = await boot(['hang'], (model) => {
      const stream = model.stream.bind(model)
      model.stream = async function* (options) {
        childSignal = options.signal
        requestStarted()
        yield* stream(options)
      }
    })
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const jobId = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    await started
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
    expect(childSignal!.aborted).toBe(false)
    expect(ctx.jobs.kill(jobId, parent.id, 'cancelled by the user')).toBe('requested')
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('killed')
    expect(childSignal!.aborted).toBe(true)
    expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
  }, 30_000)

  it('rejects admission when the adapter unloads during preflight', async () => {
    const { ctx, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const preflightEntered = new Promise<void>((resolve) => { entered = resolve })
    const resolvePreset = ctx.agentPresets.resolve.bind(ctx.agentPresets)
    ctx.agentPresets.resolve = async (name) => {
      entered()
      await gate
      return resolvePreset(name)
    }
    try {
      const pending = ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
      await preflightEntered
      await [...ctx.loader.entries()].find(entry => entry.options.id === 'task-strategy')!.fiber!.dispose()
      release()
      await expect(pending).rejects.toThrow('Strategy component is closing')
      expect(ctx.jobs.list(parent.id)).toEqual([])
      expect(ctx.agents.list().map(agent => agent.id)).toEqual(['strategy-parent'])
    } finally {
      release()
      ctx.agentPresets.resolve = resolvePreset
    }
  }, 30_000)

  it.each([{}, { allow: ['unknown'] }, { deny: ['run_code'] }])('rejects invalid later-stage filters before starting work: %j', async (tools) => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    plan.stages[1]!.tasks[0] = { ...plan.stages[1]!.tasks[0]!, tools }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow()
    expect(model.requests).toHaveLength(0)
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })

  it.each([512, 4096])('bounds the dispatch acknowledgement at %i bytes and rejects malformed model plans', async (maxBytes) => {
    const { ctx, parent } = await boot()
    parent.ctx.tools.register(strategyTools(ctx.taskStrategies, 'bounded', maxBytes).find(tool => tool.name === 'bounded_run')!)
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    const value = await ctx.tools.execute({ callId: ToolCallId('long-name'), name: 'bounded_run',
      arguments: { task: 'task', plan: { ...plan, name: '中'.repeat(1600) } }, agent: parent, signal: new AbortController().signal })
    const text = value.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(value.isError).toBe(false)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(maxBytes)
    expect(text).toContain('truncated')
    expect(JSON.parse(text)).toMatchObject({ jobId: 'strategy-1' })
    const malformed = await ctx.tools.execute({ callId: ToolCallId('malformed'), name: 'task_strategy_run',
      arguments: { task: 'task', plan: { name: 'bad', stages: 'not an array' } }, agent: parent, signal: new AbortController().signal })
    expect(malformed.isError).toBe(true)
  })

  it('applies a valid selected-preset filter and preserves an explicit empty allowlist', async () => {
    const { ctx, model, parent } = await boot()
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'task' })
    plan.stages[0]!.tasks[0] = { ...plan.stages[0]!.tasks[0]!, tools: { allow: ['reviewing_only'] } }
    plan.stages[1]!.tasks[0] = { ...plan.stages[1]!.tasks[0]!, tools: { allow: [] } }
    const job = await ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(job, 5000, parent.id)).status).toBe('completed')
    expect(model.requests.map(request => request.tools?.map(tool => tool.name) ?? [])).toEqual([['reviewing_only'], []])
  })
})

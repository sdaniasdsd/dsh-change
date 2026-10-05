import { afterEach, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import Presets from '@deepseek-ai/dsh-agent-preset-registry'
import Preset from '@deepseek-ai/dsh-agent-preset'
import Adapter from '../src/cordis.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { ExecutionPlan } from '../src/types.ts'
import { strategyTools } from '../src/tools.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function boot(
  script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('risks found'), textResponse('implemented')],
  configureModel?: (model: MockAdapter) => void,
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
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  const model = new MockAdapter(script)
  configureModel?.(model)
  ctx.llm.registerAdapter(['mock'], model)
  const handle = await ctx.agents.create({
    sessionId: SessionId('strategy-parent'), agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  return { ctx, model, parent: handle.agent }
}

describe('Loader-composed strategy adapter', () => {
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
    const report = JSON.parse(output.result!)
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
    expect(JSON.parse(value.content.filter(block => block.type === 'text').map(block => block.text).join('')).strategies)
      .toEqual([{ id: 'review-first', description: 'Review, then implement' }])
    expect(JSON.parse(value.content.filter(block => block.type === 'text').map(block => block.text).join('')).presets)
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
    expect(JSON.parse(text).jobId).toBe('strategy-1')
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

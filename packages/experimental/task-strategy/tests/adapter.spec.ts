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
import Llm from '@deepseek-ai/dsh-llm'
import Sessions from '@deepseek-ai/dsh-session'
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
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function boot(script: ConstructorParameters<typeof MockAdapter>[0] = [textResponse('child complete')]) {
  const ctx = new Context()
  contexts.push(ctx)
  const directory = await mkdtemp(join(tmpdir(), 'dsh-task-strategy-'))
  directories.push(directory)
  await cp(join(dirname(fileURLToPath(import.meta.url)), 'fixtures'), directory, { recursive: true })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(directory).href + '/' })
  Object.assign(ctx.loader.builtins, {
    include: Include,
    llm: Llm,
    sessions: Sessions,
    projections: Projections,
    'system-prompt': SystemPrompt,
    tools: Tools,
    agents: Agents,
    'agent-loop': AgentLoop,
    subagents: Subagents,
    spawn: Spawn,
    jobs: Jobs,
    'tool-jobs': ToolJobs,
    presets: Presets,
    preset: Preset,
    'strategy-adapter': Adapter,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  ctx.llm.registerAdapter(['mock'], new MockAdapter(script))
  const parent = (await ctx.agents.create({
    sessionId: 'strategy-parent' as never,
    agentOptions: { provider: 'mock', model: 'mock' },
  })).agent
  return { ctx, parent }
}

describe('Loader-composed task strategy carrier', () => {
  it('is available only after its explicit Cordis patch is loaded', async () => {
    const { ctx, parent } = await boot()
    expect(ctx.taskStrategies.list()).toEqual([{ id: 'review-first', description: 'Review, then implement' }])
    expect(ctx.taskStrategies.catalog().presets).toEqual(['reviewing', 'coding'])
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).toContain('task_strategy_run')
  })

  it('rejects a disallowed preset before creating a DSH job', async () => {
    const { ctx, parent } = await boot()
    const plan = {
      name: 'unauthorized',
      stages: [{ name: 'work', tasks: [{ label: 'work', preset: 'outside-policy', instruction: 'work' }] }],
    }
    await expect(ctx.taskStrategies.start(parent, 'task', plan, new AbortController().signal)).rejects.toThrow(/not allowed/u)
    expect(ctx.jobs.list(parent.id)).toEqual([])
  })

  it('dispatches ordered stages through original subagents and records job progress', async () => {
    const { ctx, parent } = await boot([textResponse('review complete'), textResponse('implementation complete')])
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'fix a bug' })
    const jobId = await ctx.taskStrategies.start(parent, 'fix a bug', plan, new AbortController().signal)
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('completed')
    const output = ctx.jobs.read(jobId, parent.id)
    expect(output.chunks.map(chunk => chunk.text).join('')).toContain('"stage":"review"')
    expect(output.chunks.map(chunk => chunk.text).join('')).toContain('"stage":"implement"')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
  })

  it('cancels active child jobs and removes upper tools when unloaded', async () => {
    const { ctx, parent } = await boot(['hang'])
    const plan = await ctx.taskStrategies.decide('review-first', { task: 'fix a bug' })
    const jobId = await ctx.taskStrategies.start(parent, 'fix a bug', plan, new AbortController().signal)
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.id === 'task-strategy')
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect((await ctx.jobs.wait(jobId, 5000, parent.id)).status).toBe('killed')
    expect(ctx.agents.list().map(agent => agent.id)).toEqual([parent.id])
    expect(ctx.tools.schemas(parent).map(tool => tool.name)).not.toContain('task_strategy_run')
  })
})

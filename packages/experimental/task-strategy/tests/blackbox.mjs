/** Plain-Node tests of published exports, composed services, and model JSON inputs. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
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
import Adapter from '@deepseek-ai/dsh-experimental-task-strategy/cordis'
import { StrategyRegistry, executePlan } from '@deepseek-ai/dsh-experimental-task-strategy'
import { parse } from 'yaml'

const signal = () => new AbortController().signal
const plan = (label = 'new') => ({ name: label, stages: [{ name: label, tasks: [
  { label, preset: 'coding', instruction: `Execute ${label}` },
] }] })
const deferred = () => Promise.withResolvers()

class ScriptedModel extends LlmAdapter {
  requests = []
  active = 0
  peak = 0
  constructor(script) { super(); this.script = [...script] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(request) {
    this.requests.push(request)
    const entry = this.script.shift()
    assert.ok(entry, 'model response script exhausted')
    this.active++
    this.peak = Math.max(this.peak, this.active)
    try {
      entry.entered?.resolve()
      if (entry.gate) {
        const interrupted = deferred()
        const abort = () => interrupted.reject(request.signal.reason)
        request.signal.addEventListener('abort', abort, { once: true })
        try { await Promise.race([entry.gate.promise, interrupted.promise]) }
        finally { request.signal.removeEventListener('abort', abort) }
      }
      request.signal?.throwIfAborted()
      if (entry.hang) {
        await new Promise((resolve, reject) => {
          const abort = () => { reject(request.signal.reason) }
          request.signal.addEventListener('abort', abort, { once: true })
        })
      }
      if (entry.strategy !== undefined) {
        const id = ToolCallId('selection-result')
        const args = JSON.stringify({ strategy: entry.strategy })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'structured_output', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'structured_output', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const text = entry.text ?? 'done'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally { this.active-- }
  }
}

async function boot(t, script = [{ text: 'risks found' }, { text: 'implemented' }], config) {
  const ctx = new Context()
  const directory = await mkdtemp(join(tmpdir(), 'dsh-strategy-blackbox-'))
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))
  for (const name of ['cordis.yml', 'preset-tool.js', 'package.json']) await cp(join(fixtures, name), join(directory, name))
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(directory).href + '/' })
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: Llm, sessions: Sessions, projections: Projections, 'system-prompt': SystemPrompt,
    tools: Tools, agents: Agents, 'agent-loop': AgentLoop, subagents: Subagents, spawn: Spawn,
    jobs: Jobs, 'tool-jobs': ToolJobs, presets: Presets, preset: Preset, 'strategy-adapter': Adapter,
    'token-meter': TokenMeter,
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: './cordis.yml' } })
  await ctx.loader.await()
  const entry = [...ctx.loader.entries()].find(value => value.options.id === 'task-strategy')
  if (config) {
    await entry.fiber.dispose()
    entry.options.config = { ...entry.options.config, ...config }
    await entry.init()
    await ctx.loader.await()
  }
  const model = new ScriptedModel(script)
  ctx.llm.registerAdapter(['mock'], model)
  const handle = await ctx.agents.create({ sessionId: SessionId('blackbox-owner'),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  const parent = handle.agent
  let calls = 0
  const invoke = (suffix, args) => ctx.tools.execute({ name: `task_strategy_${suffix}`,
    callId: ToolCallId(`blackbox-${++calls}`), arguments: JSON.parse(JSON.stringify(args)), agent: parent, signal: signal() })
  const submit = (requestId, extra = {}) => ctx.taskStrategies.submit(parent,
    { requestId, strategy: 'review-first', task: '修复编译问题', ...extra }, signal())
  const wait = jobId => ctx.jobs.wait(jobId, 5000, parent.id)
  return { ctx, model, parent, handle, entry, invoke, submit, wait }
}

async function until(predicate) {
  for (let index = 0; index < 500; index++) {
    if (predicate()) return
    await delay(10)
  }
  assert.fail('public state did not reach the expected phase within 5 seconds')
}
const textOf = result => result.content.filter(block => block.type === 'text').map(block => block.text).join('')

test('all twelve shipped workflows pass original preset and provider admission without model calls', async t => {
  const patch = parse(await readFile(new URL('../../../../strategies/workflows.patch.yml', import.meta.url), 'utf8'))
  const strategies = patch[0].insert[0].config.strategies
  const { ctx, model } = await boot(t, [], { allowedPresets: ['coding', 'reviewing', 'standard'], strategies })
  const remove = await ctx.agentPresets.register({ id: 'standard', plugins: [] })
  ctx.effect(() => remove)
  assert.equal(ctx.taskStrategies.list().length, 12)
  for (const strategy of strategies) {
    const admitted = await ctx.taskStrategies.decide(strategy.id, { task: 'Original task' })
    assert.equal(admitted.stages.flatMap(stage => stage.tasks).length,
      strategy.id.endsWith('-low') ? 1 : strategy.id.endsWith('-medium') ? 3 : 6)
  }
  assert.equal(model.requests.length, 0)
})

test('seven tasks fit the default result budget only when their accumulated JSON fits', async () => {
  const seven = { name: 'seven', stages: Array.from({ length: 7 }, (_, index) => ({ name: `s${index}`,
    tasks: [{ label: `t${index}`, preset: 'coding', instruction: 'work' }] })) }
  const options = { maxConcurrent: 1, maxTasks: 16, maxResultBytes: 65536, signal: signal() }
  const small = await executePlan(seven, 'task', async () => ({ stopReason: 'completed', output: 'small' }), options)
  assert.equal(small.status, 'completed')
  assert.equal(small.results.length, 7)
  const large = await executePlan(seven, 'task', async () => ({ stopReason: 'completed', output: 'x'.repeat(10000) }), options)
  assert.equal(large.status, 'failed')
  assert.match(large.error, /result byte limit 65536/)
})

test('published catalogue prices task inputs and the selector receives the same cost data', async t => {
  const { ctx, model, parent, invoke, wait } = await boot(t, [{ strategy: 'review-first' }, {}, {}])
  const baseline = ctx.taskStrategies.catalog().strategies[0].cost
  assert.equal(baseline.kind, 'estimated')
  assert.equal(baseline.basis, 'registration')
  const result = await invoke('list', { task: 'Original task', preferences: { speed: 'fast' } })
  assert.equal(result.isError, false)
  const cost = JSON.parse(textOf(result)).strategies[0].cost
  assert.equal(cost.basis, 'task')
  assert.equal(cost.tasks, 2)
  assert.ok(cost.knownInputTokens > baseline.knownInputTokens)
  assert.equal(model.requests.length, 0)
  const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'cost-choice', task: 'Original task',
    preferences: { speed: 'fast' } }, signal())
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.ok(JSON.stringify(model.requests[0].messages).includes('knownInputTokens'))
  assert.ok(JSON.stringify(model.requests[0].messages).includes('unknown cost is not zero'))
})

test('automatic intake captures one structured choice, admits once and retains accepted work after unload', async t => {
  const { ctx, model, parent, entry, wait } = await boot(t, [{ strategy: 'review-first' }, { text: 'risks' }, { text: 'done' }])
  const request = { requestId: 'auto-task', task: '  Original task\n', preferences: { goal: 'safe' } }
  const first = ctx.taskStrategies.submitTask(parent, request, signal())
  const second = ctx.taskStrategies.submitTask(parent, structuredClone(request), signal())
  assert.equal(first, second)
  const receipt = await first
  assert.equal(receipt.strategy, 'review-first')
  assert.equal(ctx.jobs.list(parent.id).length, 1)
  assert.deepEqual(model.requests[0].tools.map(tool => tool.name), ['structured_output'])
  assert.ok(model.requests[0].messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes(JSON.stringify(request.task)))))
  await entry.fiber.dispose()
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.equal(model.requests.length, 3)
  assert.equal(ctx.agents.list().length, 1)
})

test('submit tool honors an explicit strategy and returns the selected strategy without selector cost', async t => {
  const { ctx, model, parent, invoke, wait } = await boot(t)
  const result = await invoke('submit', { requestId: 'manual-task', task: 'task', strategy: 'review-first', preferences: { goal: 'safe' } })
  assert.notEqual(result.isError, true, textOf(result))
  const receipt = JSON.parse(textOf(result))
  assert.equal(receipt.strategy, 'review-first')
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.equal(model.requests.length, 2)
  assert.equal(ctx.jobs.list(parent.id).length, 1)
})

for (const interruption of ['timeout', 'caller', 'carrier', 'owner']) {
  test(`automatic intake ${interruption} drains the selector without accepting a Job`, async t => {
    const entered = deferred()
    const { ctx, model, parent, entry, handle } = await boot(t, [{ entered, hang: true }], {
      selection: { timeoutMs: interruption === 'timeout' ? 100 : 30000 },
    })
    const controller = new AbortController()
    const pending = ctx.taskStrategies.submitTask(parent, { requestId: interruption, task: 'task' }, controller.signal)
    const rejected = assert.rejects(pending)
    await entered.promise
    if (interruption === 'caller') controller.abort(new Error('cancel choice'))
    if (interruption === 'carrier') await entry.fiber.dispose()
    if (interruption === 'owner') await handle.dispose()
    await rejected
    assert.equal(ctx.jobs.list(parent.id).length, 0)
    assert.equal(model.active, 0)
    assert.equal(ctx.agents.list().length, interruption === 'owner' ? 0 : 1)
  })
}

for (const kind of ['auto', 'named']) {
  test(`long names retain parseable ${kind} submit receipts and complete strategy identities`, async t => {
    const script = [{ text: 'risks' }, { text: 'done' }]
    if (kind === 'auto') script.unshift({ strategy: 'long-name' })
    const { ctx, parent, invoke, wait } = await boot(t, script, { maxOutputBytes: 512 })
    const selected = plan(); selected.name = '策略'.repeat(600)
    ctx.taskStrategies.register({ id: 'long-name', description: 'Long display name', decide: () => selected })
    const result = await invoke('submit', { requestId: 'long-name', task: 'task', ...kind === 'named' ? { strategy: 'long-name' } : {} })
    assert.equal(result.isError, false, textOf(result))
    assert.ok(Buffer.byteLength(textOf(result)) <= 512)
    const receipt = JSON.parse(textOf(result))
    assert.equal(receipt.strategy, 'long-name')
    assert.equal(receipt.jobId, 'strategy-1')
    assert.equal((await wait(receipt.jobId)).status, 'completed')
    assert.equal(ctx.jobs.list(parent.id).length, 1)
  })

  test(`oversized ${kind} strategy identities refuse acceptance before any Job`, async t => {
    const id = '策'.repeat(300)
    const { ctx, parent } = await boot(t, [{ strategy: id }], { maxOutputBytes: 512 })
    ctx.taskStrategies.register({ id, description: 'Oversized identity', decide: () => plan() })
    await assert.rejects(ctx.taskStrategies.submitTask(parent, { requestId: 'oversized', task: 'task',
      ...kind === 'named' ? { selection: { kind: 'named', strategy: id } } : {},
    }, signal()), /receipt byte limit/)
    assert.equal(ctx.jobs.list(parent.id).length, 0)
  })
}

test('unstructured selector text refuses admission and releases its request id for a corrected retry', async t => {
  const { ctx, parent, wait } = await boot(t, [{ text: '{"strategy":"review-first"}' }, { text: 'risks' }, { text: 'done' }])
  await assert.rejects(ctx.taskStrategies.submitTask(parent, { requestId: 'retry-choice', task: 'task' }, signal()), /selection|structured/i)
  assert.equal(ctx.jobs.list(parent.id).length, 0)
  const receipt = await ctx.taskStrategies.submitTask(parent, { requestId: 'retry-choice', task: 'task', selection: { kind: 'named', strategy: 'review-first' } }, signal())
  assert.equal((await wait(receipt.jobId)).status, 'completed')
})

test('lowering the receipt cap across remount reports an accepted Job without duplicate execution', async t => {
  const { ctx, parent, entry, invoke, wait } = await boot(t)
  const id = 'x'.repeat(600)
  ctx.taskStrategies.register({ id, description: 'Previously accepted identity', decide: () => plan() })
  const request = { requestId: 'retained-large-receipt', task: 'task', selection: { kind: 'named', strategy: id } }
  const receipt = await ctx.taskStrategies.submitTask(parent, request, signal())
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  await entry.fiber.dispose()
  entry.options.config = { ...entry.options.config, maxOutputBytes: 512 }
  await entry.init()
  await ctx.loader.await()
  const result = await invoke('submit', { requestId: request.requestId, task: request.task, strategy: id })
  assert.equal(result.isError, true)
  assert.ok(Buffer.byteLength(textOf(result)) <= 512)
  assert.match(textOf(result), /already accepted/)
  assert.ok(textOf(result).includes(receipt.jobId))
  assert.equal(ctx.jobs.list(parent.id).length, 1)
  assert.deepEqual(await ctx.taskStrategies.submitTask(parent, request, signal()), receipt)
})

test('package names resolve exclusively to built JavaScript', () => {
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-agent-loop',
    '@deepseek-ai/dsh-experimental-task-strategy', '@deepseek-ai/dsh-experimental-task-strategy/cordis']) {
    assert.match(import.meta.resolve(name), /\/lib\/.+\.js$/)
  }
})

test('public registry captures synchronous decisions and detached input/output', () => {
  const registry = new StrategyRegistry()
  const original = plan()
  const unregister = registry.register({ id: 'local', description: 'local', decide(input) {
    input.preferences.speed = 'changed'
    return original
  } })
  const input = { task: 'task', preferences: { speed: 'fast' } }
  const decided = registry.decide('local', input)
  assert.equal(decided.then, undefined)
  decided.stages[0].tasks[0].label = 'mutated'
  assert.equal(input.preferences.speed, 'fast')
  assert.equal(original.stages[0].tasks[0].label, 'new')
  unregister(); unregister()
  assert.throws(() => registry.decide('local', input), /Unknown strategy/)
})

test('Loader dispatch preserves stage order, prior results, preset tools, and releases children', async t => {
  const { ctx, model, parent, submit, wait } = await boot(t)
  const receipt = await submit('normal')
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  const state = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.equal(state.phase, 'completed')
  assert.equal(state.completedStages, 2)
  assert.deepEqual(state.results.map(row => row.label), ['inspect', 'implement'])
  const prompts = model.requests.map(request => JSON.stringify(request.messages))
  assert.match(prompts[1], /risks found/)
  assert.ok(model.requests[0].tools.some(tool => tool.name === 'reviewing_only'))
  assert.ok(model.requests[1].tools.some(tool => tool.name === 'coding_only'))
  assert.ok(model.requests.every(request => request.tools.every(tool => !tool.name.startsWith('task_strategy_'))))
  assert.equal(model.active, 0)
  assert.equal(ctx.agents.list().length, 1)
})

test('concurrent equal submissions share one Job despite preference key order', async t => {
  const { ctx, parent, submit, wait, model } = await boot(t)
  const [a, b] = await Promise.all([submit('same', { preferences: { z: 'z', a: 'a' } }),
    submit('same', { preferences: { a: 'a', z: 'z' } })])
  assert.equal(a.jobId, b.jobId)
  assert.equal(ctx.jobs.list(parent.id).length, 1)
  await wait(a.jobId)
  assert.equal((await submit('same', { preferences: { a: 'a', z: 'z' } })).jobId, a.jobId)
  assert.equal(model.requests.length, 2)
})

test('conflicting request id rejects and a failed admission can retry its id', async t => {
  const { submit, wait } = await boot(t)
  await assert.rejects(submit('retry', { strategy: 'missing' }), /Unknown strategy/)
  const receipt = await submit('retry')
  await assert.rejects(submit('retry', { task: 'different' }), /request|payload/i)
  await wait(receipt.jobId)
})

test('replacement drains the active stage then uses the captured target even after unregister', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, model, parent, submit, wait } = await boot(t, [{ entered, gate, text: 'old data' }, { text: 'new data' }])
  t.after(() => gate.resolve())
  const dispose = ctx.taskStrategies.register({ id: 'replacement', description: 'new', decide: () => plan() })
  const receipt = await submit('replace')
  await entered.promise
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'replacement' })
  assert.throws(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'replacement' }), /already pending/)
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).binding.id, 'review-first')
  dispose(); gate.resolve()
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  const state = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.equal(state.binding.id, 'replacement')
  assert.equal(state.binding.epoch, 1)
  assert.deepEqual(state.results.map(row => row.label), ['inspect', 'new'])
  assert.match(JSON.stringify(model.requests[1].messages), /old data/)
})

test('rejected replacement waits for explicit resume and retains the original cursor', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, model, parent, submit, wait } = await boot(t, [{ entered, gate }, {}])
  t.after(() => gate.resolve())
  const receipt = await submit('bad-switch')
  await entered.promise
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'missing' })
  gate.resolve()
  await until(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase === 'waiting')
  assert.equal(model.requests.length, 1)
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).binding.epoch, 0)
  ctx.taskStrategies.resume(parent, receipt.jobId, 0)
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.equal(model.requests.length, 2)
  assert.throws(() => ctx.taskStrategies.resume(parent, receipt.jobId, 0), /settled/)
})

test('cancellation drains the child and terminal control cannot restart it', async t => {
  const entered = deferred()
  const { ctx, model, parent, submit, wait } = await boot(t, [{ entered, hang: true }])
  const receipt = await submit('cancel')
  await entered.promise
  assert.equal(ctx.jobs.kill(receipt.jobId, parent.id), 'requested')
  assert.equal((await wait(receipt.jobId)).status, 'killed')
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).phase, 'cancelled')
  assert.equal(model.active, 0)
  assert.equal(ctx.agents.list().length, 1)
  assert.throws(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'review-first' }), /settled/)
})

test('aborted admission creates no Job and permits a later retry', async t => {
  const { ctx, parent, submit, wait, model } = await boot(t)
  const controller = new AbortController(); controller.abort(new Error('caller left'))
  await assert.rejects(ctx.taskStrategies.submit(parent,
    { requestId: 'abort', strategy: 'review-first', task: 'task' }, controller.signal), /caller left/)
  assert.equal(ctx.jobs.list(parent.id).length, 0)
  assert.equal(model.requests.length, 0)
  await wait((await submit('abort')).jobId)
})

test('carrier remount preserves accepted work and submission identity', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, parent, entry, submit, wait } = await boot(t, [{ entered, gate }, {}])
  t.after(() => gate.resolve())
  const receipt = await submit('remount')
  await entered.promise
  await entry.fiber.dispose(); await entry.init(); await ctx.loader.await()
  assert.equal((await submit('remount')).jobId, receipt.jobId)
  gate.resolve()
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).results.length, 2)
})

test('foreign Agent cannot inspect or switch another owners task', async t => {
  const { ctx, parent, submit, wait } = await boot(t)
  const receipt = await submit('owned')
  const other = await ctx.agents.create({ sessionId: SessionId('foreign'), agentOptions: { provider: 'mock', model: 'mock' } })
  assert.throws(() => ctx.taskStrategies.inspect(other.agent, receipt.jobId))
  assert.throws(() => ctx.taskStrategies.requestSwitch(other.agent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'review-first' }))
  await wait(receipt.jobId)
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).phase, 'completed')
})

for (const [label, args] of [
  ['missing selection', { task: 'task' }],
  ['ambiguous selection', { task: 'task', strategy: 'review-first', plan: plan() }],
  ['unknown strategy', { task: 'task', strategy: 'missing' }],
  ['missing plan fields', { task: 'task', plan: { stages: [] } }],
  ['null plan', { task: 'task', plan: null }],
  ['numeric preference', { task: 'task', strategy: 'review-first', preferences: { speed: 1 } }],
  ['array preferences', { task: 'task', strategy: 'review-first', preferences: ['fast'] }],
  ['empty stage', { task: 'task', plan: { name: 'empty', stages: [{ name: 'empty', tasks: [] }] } }],
  ['disallowed preset', { task: 'task', plan: { name: 'denied', stages: [{ name: 'work', tasks: [
    { label: 'denied', preset: 'undeclared', instruction: 'work' },
  ] }] } }],
  ['unknown tool', { task: 'task', plan: { name: 'denied', stages: [{ name: 'work', tasks: [
    { label: 'denied', preset: 'coding', instruction: 'work', tools: { allow: ['missing'] } },
  ] }] } }],
  ['too many tasks', { task: 'task', plan: { name: 'large', stages: [{ name: 'work', tasks: Array.from({ length: 9 },
    (_, index) => ({ label: `${index}`, preset: 'coding', instruction: 'work' })) }] } }],
  ['oversized plan', { task: 'task', plan: plan('中'.repeat(3000)) }],
  ['blank task', { task: ' \n\t', strategy: 'review-first' }],
  ['blank explicit task', { task: '', plan: plan() }],
]) {
  test(`model JSON rejects ${label} before Job creation`, async t => {
    const { ctx, parent, model, invoke } = await boot(t)
    const result = await invoke('run', args)
    assert.equal(result.isError, true, textOf(result))
    assert.equal(ctx.jobs.list(parent.id).length, 0)
    assert.equal(model.requests.length, 0)
  })
}

test('preview and host admission reject blank tasks without calling the author', async t => {
  const { ctx, parent, model, invoke, submit } = await boot(t)
  let decisions = 0
  ctx.taskStrategies.register({ id: 'count', description: 'count', decide: () => { decisions++; return plan() } })
  assert.equal((await invoke('plan', { task: ' \n\t', strategy: 'count' })).isError, true)
  await assert.rejects(submit('empty', { task: '', strategy: 'count' }), /Task must not be empty/)
  await assert.rejects(ctx.taskStrategies.start(parent, '', plan(), signal()), /Task must not be empty/)
  assert.equal(decisions, 0)
  assert.equal(ctx.jobs.list(parent.id).length, 0)
  assert.equal(model.requests.length, 0)
})

test('model JSON list, preview and named dispatch return bounded parseable responses', async t => {
  const { invoke, wait } = await boot(t)
  const list = await invoke('list', {})
  assert.equal(list.isError, false)
  assert.equal(JSON.parse(textOf(list)).strategies[0].id, 'review-first')
  const preview = await invoke('plan', { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } })
  assert.equal(preview.isError, false)
  assert.equal(JSON.parse(textOf(preview)).stages.length, 2)
  const result = await invoke('run', { task: 'task', strategy: 'review-first', preferences: { speed: 'fast' } })
  assert.equal(result.isError, false)
  const receipt = JSON.parse(textOf(result))
  assert.equal(receipt.progress, 'job_output')
  assert.equal((await wait(receipt.jobId)).status, 'completed')
})

test('multibyte long plan names keep the receipt parseable at the minimum output cap', async t => {
  const { invoke, wait } = await boot(t, undefined, { maxOutputBytes: 512 })
  const selected = plan(); selected.name = '策略'.repeat(600)
  const result = await invoke('run', { task: 'task', plan: selected })
  assert.equal(result.isError, false)
  const text = textOf(result)
  assert.ok(Buffer.byteLength(text) <= 512)
  assert.equal(text.includes('\uFFFD'), false)
  const receipt = JSON.parse(text)
  assert.equal((await wait(receipt.jobId)).status, 'completed')
})

test('result limit failure releases the child and suppresses the next stage', async t => {
  const { ctx, model, parent, submit, wait } = await boot(t, [{ text: '中'.repeat(100) }], { maxResultBytes: 200 })
  const receipt = await submit('result-cap')
  assert.equal((await wait(receipt.jobId)).status, 'failed')
  assert.match(ctx.taskStrategies.inspect(parent, receipt.jobId).error, /result byte limit/)
  assert.equal(model.requests.length, 1)
  assert.equal(model.active, 0)
  assert.equal(ctx.agents.list().length, 1)
})

test('wide stages obey concurrency limits and drain before later-stage dispatch', async t => {
  const first = deferred(), second = deferred(), gate = deferred()
  const { ctx, model, parent, wait } = await boot(t, [{ entered: first, gate }, { entered: second, gate }, {}, {}])
  const selected = { name: 'wide', stages: [
    { name: 'parallel', tasks: ['a', 'b', 'c'].map(label => ({ label, preset: 'coding', instruction: label })) },
    { name: 'after', tasks: [{ label: 'after', preset: 'coding', instruction: 'after' }] },
  ] }
  const jobId = await ctx.taskStrategies.start(parent, 'task', selected, signal())
  await Promise.all([first.promise, second.promise])
  assert.equal(model.requests.length, 2)
  assert.equal(model.active, 2)
  gate.resolve()
  assert.equal((await wait(jobId)).status, 'completed')
  assert.equal(model.peak, 2)
  assert.deepEqual(ctx.taskStrategies.inspect(parent, jobId).results.map(row => row.label), ['a', 'b', 'c', 'after'])
  assert.equal(model.active, 0)
})

test('one failed parallel child cancels its sibling and does not enter the next stage', async t => {
  const { ctx, model, parent, wait } = await boot(t, [{ hang: true }, { text: '中'.repeat(500) }], { maxResultBytes: 200 })
  const selected = { name: 'parallel-failure', stages: [
    { name: 'parallel', tasks: ['hang', 'large'].map(label => ({ label, preset: 'coding', instruction: label })) },
    { name: 'after', tasks: [{ label: 'after', preset: 'coding', instruction: 'after' }] },
  ] }
  const jobId = await ctx.taskStrategies.start(parent, 'task', selected, signal())
  assert.equal((await wait(jobId)).status, 'failed')
  assert.equal(model.requests.length, 2)
  assert.equal(model.active, 0)
  assert.equal(ctx.agents.list().length, 1)
})

test('replacement selects its explicit target cursor and does not execute skipped target stages', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, parent, submit, wait } = await boot(t, [{ entered, gate }, {}])
  ctx.taskStrategies.register({ id: 'cursor', description: 'cursor', decide: () => ({ name: 'cursor',
    stages: [...plan('skip').stages, ...plan('target').stages] }) })
  const receipt = await submit('cursor')
  await entered.promise
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'cursor', startStage: 1 })
  gate.resolve()
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  assert.deepEqual(ctx.taskStrategies.inspect(parent, receipt.jobId).results.map(row => row.label), ['inspect', 'target'])
})

test('replacement cannot reset the cumulative task allowance', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, model, parent, submit, wait } = await boot(t, [{ entered, gate }, {}], { maxTasks: 2 })
  const target = plan('target'); target.stages[0].tasks.push({ label: 'second', preset: 'coding', instruction: 'second' })
  ctx.taskStrategies.register({ id: 'wide-target', description: 'wide', decide: () => target })
  const receipt = await submit('cumulative')
  await entered.promise
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'wide-target' })
  gate.resolve()
  await until(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase === 'waiting')
  const state = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.equal(state.binding.epoch, 0)
  assert.match(state.error, /cumulative task limit/)
  assert.equal(model.requests.length, 1)
  ctx.taskStrategies.resume(parent, receipt.jobId, 0)
  assert.equal((await wait(receipt.jobId)).status, 'completed')
})

test('cancellation while waiting for a rejected switch settles without resume', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, parent, submit, wait } = await boot(t, [{ entered, gate }])
  const receipt = await submit('waiting-cancel')
  await entered.promise
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { expectedBindingEpoch: 0, strategy: 'missing' })
  gate.resolve()
  await until(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase === 'waiting')
  ctx.jobs.kill(receipt.jobId, parent.id)
  assert.equal((await wait(receipt.jobId)).status, 'killed')
  assert.equal(ctx.taskStrategies.inspect(parent, receipt.jobId).phase, 'cancelled')
})

test('destroying the owner cancels owned children and rejects its stale handle', async t => {
  const entered = deferred()
  const { ctx, model, parent, handle, submit } = await boot(t, [{ entered, hang: true }])
  await submit('owner-dispose')
  await entered.promise
  await handle.dispose()
  assert.equal(model.active, 0)
  assert.equal(ctx.agents.list().length, 0)
  await assert.rejects(submit('stale'), /exact live owner/)
  await ctx.agents.create({ sessionId: parent.id, agentOptions: { provider: 'mock', model: 'mock' } })
  await assert.rejects(submit('recreated'), /exact live owner/)
})

test('unavailable execution provider fails admission before creating a Job', async t => {
  const { ctx, parent, submit, model } = await boot(t, undefined, { provider: 'missing' })
  await assert.rejects(submit('provider'), /preset-selecting/)
  assert.equal(ctx.jobs.list(parent.id).length, 0)
  assert.equal(model.requests.length, 0)
})

test('accepted task retains a detached submission even if its caller mutates it immediately', async t => {
  const { ctx, parent, wait } = await boot(t)
  const request = { requestId: 'detached', task: 'original task', strategy: 'review-first', preferences: { speed: 'fast' } }
  const accepted = ctx.taskStrategies.submit(parent, request, signal())
  request.task = ''; request.strategy = 'missing'; request.preferences.speed = 'changed'
  const receipt = await accepted
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  const again = await ctx.taskStrategies.submit(parent,
    { requestId: 'detached', task: 'original task', strategy: 'review-first', preferences: { speed: 'fast' } }, signal())
  assert.equal(again.jobId, receipt.jobId)
})

test('nonblank task whitespace reaches children unchanged', async t => {
  const { ctx, model, parent, wait } = await boot(t)
  const jobId = await ctx.taskStrategies.start(parent, '  保留任务缩进\n', plan(), signal())
  assert.equal((await wait(jobId)).status, 'completed')
  assert.match(JSON.stringify(model.requests[0].messages), /Task:\\n  保留任务缩进\\n\\n\\nInstructions/)
})

test('stale host controls preserve task state and do not evaluate the replacement author', async t => {
  const entered = deferred(), gate = deferred()
  const { ctx, parent, submit, wait } = await boot(t, [{ entered, gate }, {}])
  let decisions = 0
  ctx.taskStrategies.register({ id: 'counted', description: 'counted', decide: () => { decisions++; return plan('counted') } })
  const receipt = await submit('epoch-guard')
  await entered.promise
  const before = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.throws(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId,
    { strategy: 'counted', expectedBindingEpoch: before.binding.epoch + 1 }), /binding epoch changed/)
  assert.equal(decisions, 0)
  assert.deepEqual(ctx.taskStrategies.inspect(parent, receipt.jobId), before)
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'missing', expectedBindingEpoch: before.binding.epoch })
  gate.resolve()
  await until(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase === 'waiting')
  const waiting = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.throws(() => ctx.taskStrategies.resume(parent, receipt.jobId, before.binding.epoch + 1), /binding epoch changed/)
  assert.deepEqual(ctx.taskStrategies.inspect(parent, receipt.jobId), waiting)
  ctx.taskStrategies.resume(parent, receipt.jobId, before.binding.epoch)
  assert.equal((await wait(receipt.jobId)).status, 'completed')
})

test('a view captured before binding commitment cannot switch or resume the new binding', async t => {
  const oldEntered = deferred(), oldGate = deferred(), newEntered = deferred(), newGate = deferred()
  const { ctx, parent, submit, wait } = await boot(t, [
    { entered: oldEntered, gate: oldGate }, { entered: newEntered, gate: newGate }, {},
  ])
  ctx.taskStrategies.register({ id: 'one', description: 'one', decide: () => plan('one') })
  let decisions = 0
  ctx.taskStrategies.register({ id: 'two', description: 'two', decide: () => { decisions++; return plan('two') } })
  const receipt = await submit('stale-view')
  await oldEntered.promise
  const oldView = ctx.taskStrategies.inspect(parent, receipt.jobId)
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'one', expectedBindingEpoch: oldView.binding.epoch })
  oldGate.resolve()
  await newEntered.promise
  const current = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.equal(current.binding.epoch, 1)
  assert.throws(() => ctx.taskStrategies.requestSwitch(parent, receipt.jobId,
    { strategy: 'two', expectedBindingEpoch: oldView.binding.epoch }), /binding epoch changed/)
  assert.deepEqual(ctx.taskStrategies.inspect(parent, receipt.jobId), current)
  assert.equal(decisions, 0)
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'missing', expectedBindingEpoch: current.binding.epoch })
  newGate.resolve()
  await until(() => ctx.taskStrategies.inspect(parent, receipt.jobId).phase === 'waiting')
  const waiting = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.throws(() => ctx.taskStrategies.resume(parent, receipt.jobId, oldView.binding.epoch), /binding epoch changed/)
  assert.deepEqual(ctx.taskStrategies.inspect(parent, receipt.jobId), waiting)
  ctx.taskStrategies.requestSwitch(parent, receipt.jobId, { strategy: 'two', expectedBindingEpoch: waiting.binding.epoch })
  assert.equal((await wait(receipt.jobId)).status, 'completed')
  const terminal = ctx.taskStrategies.inspect(parent, receipt.jobId)
  assert.deepEqual(terminal.results.map(row => row.label), ['inspect', 'one', 'two'])
  assert.equal(terminal.binding.epoch, 2)
  assert.equal(decisions, 1)
})

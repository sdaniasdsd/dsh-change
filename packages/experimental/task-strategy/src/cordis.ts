/** Opt-in Cordis carrier for the independent task-strategy component. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subagent'
import { StrategyRegistry } from './index.ts'
import { executePlan, validatePlan } from './executor.ts'
import { adapterSchema, boundText } from './schema.ts'
import { strategyTools } from './tools.ts'
import type { AdapterConfig, AuthorStrategy, ExecutionPlan, StrategyInput, TaskExecutor } from './types.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { strategy: 'strategy' }
}

/** DSH integration; strategy identities remain outside the plugin registry. */
export default class TaskStrategies extends Service {
  static inject = ['agents', 'tools', 'subagents', 'agentPresets', 'jobs']
  static Config = adapterSchema
  private readonly registry = new StrategyRegistry()
  private readonly active = new Map<AbortController, Promise<JobOutcome>>()
  private closing = false
  private readonly config: AdapterConfig

  constructor(ctx: Context, config: AdapterConfig) {
    super(ctx, 'taskStrategies')
    this.config = structuredClone(config)
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith('max') && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
        throw new Error(`${key} must be a positive safe integer`)
      }
    }
    if (!config.toolPrefix.trim() || !config.provider.trim()) throw new Error('Strategy carrier names must not be empty')
    ctx.effect(() => async () => {
      this.closing = true
      for (const controller of this.active.keys()) controller.abort(new Error('strategy component unloaded'))
      await Promise.all(this.active.values())
    })
    for (const definition of config.strategies) {
      const captured = structuredClone(definition)
      this.register({
        id: captured.id,
        description: captured.description,
        decide: input => captured.variants
          ?.find(variant => input.preferences?.[variant.preference] === variant.equals)?.plan ?? captured.plan,
      })
    }
    const installed = new WeakSet<Agent>()
    const mount = (agent: Agent): void => {
      if (agent.session.header.origin === 'subagent' || installed.has(agent)) return
      installed.add(agent)
      for (const tool of strategyTools(this, config.toolPrefix, config.maxOutputBytes)) {
        ctx.effect(() => agent.ctx.tools.register(tool))
      }
    }
    ctx.on('agent/created', ({ agent }) => { mount(agent) })
    for (const agent of ctx.agents.list()) mount(agent)
  }

  /** Register an author strategy under the caller's Cordis lifetime. */
  register(strategy: AuthorStrategy): () => void {
    if (this.closing) throw new Error('Strategy component is closing')
    return this.ctx.effect(() => this.registry.register(strategy))
  }

  /** List registered author decisions without evaluating them. */
  list(): { id: string; description: string }[] { return this.registry.list() }

  /** Describe author policies and permitted original DSH presets. */
  catalog(): { strategies: { id: string; description: string }[]; presets: string[] } {
    return { strategies: this.list(), presets: [...this.config.allowedPresets] }
  }

  /** Evaluate and preflight an author decision without dispatching work. */
  async decide(id: string, input: StrategyInput): Promise<ExecutionPlan> {
    const plan = await this.registry.decide(id, input)
    await this.preflight(plan)
    return plan
  }

  private async preflight(plan: ExecutionPlan): Promise<void> {
    const { maxConcurrent, maxTasks, maxResultBytes, maxPlanBytes, allowedPresets } = this.config
    validatePlan(plan, { maxConcurrent, maxTasks, maxResultBytes })
    if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > maxPlanBytes) throw new Error(`Execution plan exceeds byte limit ${maxPlanBytes}`)
    const provider = this.ctx.subagents.getProvider(this.config.provider)
    if (provider?.capabilities.agentPreset !== true) throw new Error('Strategy executor requires a preset-selecting subagent provider')
    const names = new Set<string>()
    const steps = plan.stages.flatMap(stage => stage.tasks)
    for (const step of steps) {
      if (!allowedPresets.includes(step.preset)) throw new Error(`Strategy preset is not allowed: ${step.preset}`)
      if (step.tools !== undefined && !provider.capabilities.toolFilter) throw new Error('Strategy provider does not support tool restrictions')
      if ((step.model !== undefined || step.provider !== undefined) && !provider.capabilities.agentOptions) {
        throw new Error('Strategy provider does not support model selection')
      }
      names.add(step.preset)
    }
    for (const name of names) {
      const preset = await this.ctx.agentPresets.resolve(name)
      if (preset.broken !== undefined) throw new Error(`Invalid strategy preset ${name}: ${preset.broken}`)
      const filters = steps.flatMap(step => (
        step.preset === name && step.tools !== undefined ? [{ label: step.label, filter: step.tools }] : []
      ))
      if (filters.length === 0) continue
      await using lease = await this.ctx.agentPresets.acquireScope(name)
      const known = new Set(this.ctx.tools.schemas(lease.key).map(tool => tool.name))
      for (const { label, filter } of filters) {
        const { allow, deny } = filter
        if (allow === undefined && deny === undefined) throw new Error(`Empty tool filter for task ${label}`)
        for (const tool of [...allow ?? [], ...deny ?? []]) {
          if (tool === 'run_code' || !known.has(tool)) throw new Error(`Invalid strategy tool ${tool} for preset ${name}`)
        }
      }
    }
  }

  /** Start a DSH job; child execution stays delegated to the original DSH provider. */
  async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId> {
    if (this.closing) throw new Error('Strategy component is closing')
    const captured = structuredClone(plan)
    const subagents = this.ctx.subagents
    const jobs = this.ctx.jobs
    const config = this.config
    await this.preflight(captured)
    signal.throwIfAborted()
    if (this.closing) throw new Error('Strategy component is closing')
    const execute: TaskExecutor = async (step, prompt, childSignal) => {
      const run = await subagents.start(config.provider, {
        parent, prompt: [{ type: 'text', text: prompt }], signal: childSignal,
        label: step.label, agentPreset: step.preset,
        ...step.tools === undefined ? {} : { toolFilter: {
          ...step.tools.allow === undefined ? {} : { allow: step.tools.allow },
          ...step.tools.deny === undefined ? {} : { deny: step.tools.deny },
        } },
        ...(step.model === undefined && step.provider === undefined) ? {} : {
          agentOptions: {
            ...step.model === undefined ? {} : { model: step.model },
            ...step.provider === undefined ? {} : { provider: step.provider },
          },
        },
      })
      try {
        const result = await run.result
        return {
          sessionId: run.id,
          stopReason: result.stopReason,
          output: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n'),
        }
      } finally { await run.dispose() }
    }
    return jobs.start({
      kind: 'strategy', label: captured.name, owner: parent.id, outputLimitBytes: config.maxOutputBytes,
      run: (job) => {
        const controller = new AbortController()
        job.append(`Execution plan: ${JSON.stringify(captured)}\n`, { channel: 'log' })
        const done = executePlan(captured, task, execute, {
          maxConcurrent: config.maxConcurrent,
          maxTasks: config.maxTasks,
          maxResultBytes: config.maxResultBytes,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'stage') job.updateProgress(event.stage)
            job.append(JSON.stringify(event) + '\n', { channel: 'log' })
          },
        }).then((result): JobOutcome => ({
          status: result.status === 'cancelled' ? 'killed' : result.status,
          ...result.error === undefined ? {} : { detail: boundText(result.error, config.maxOutputBytes) },
          result: boundText(JSON.stringify(result), config.maxOutputBytes),
        }), (error: unknown): JobOutcome => ({ status: 'failed', detail: boundText(String(error), config.maxOutputBytes) }))
        this.active.set(controller, done)
        void done.then(() => { this.active.delete(controller) })
        return { cancel: (reason) => { controller.abort(new Error(reason ?? 'strategy job cancelled')) }, done }
      },
    })
  }
}

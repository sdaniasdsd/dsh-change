/** Cordis carrier for the independent strategy component. */
import { Context, symbols } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import { StrategyRegistry } from './index.ts'
import { createAdmission } from './admission.ts'
import type { PlanAdmission } from './admission.ts'
import { captureStrategy } from './static-plan.ts'
import { TaskRun } from './task-run.ts'
import { validateTask } from './task-input.ts'
import { ownerRuns, reserveSubmission } from './task-submissions.ts'
import { adapterSchema, boundText } from './schema.ts'
import type { ResolvedAdapterConfig } from './schema.ts'
import { strategyTools } from './tools.ts'
import type { AdapterConfig, AuthorStrategy, ExecutionPlan, StrategyInput, TaskExecutor, StrategyCatalogEntry } from './types.ts'
import type { CapturedStrategy, TaskReceipt, TaskRunView, TaskSubmission, TaskSwitch } from './runtime-types.ts'
import type { TaskIntakeRequest } from './selection-types.ts'
import { resolveSelection } from './selection.ts'
import { selectStrategy } from './selector.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap { strategy: 'strategy' }
}

/** DSH integration; author strategy identities remain outside the plugin registry. */
export default class TaskStrategies extends TypertRemoteService {
  static inject = ['agents', 'tools', 'subagents', 'agentPresets', 'jobs', 'tokenMeter']
  static Config = adapterSchema
  private readonly registry: StrategyRegistry
  private closing = false
  private readonly config: AdapterConfig
  private readonly admission: PlanAdmission
  private readonly selectionConfig: ResolvedAdapterConfig['selection']
  private readonly intakes = new Map<AbortController, Promise<TaskReceipt>>()

  constructor(ctx: Context, config: ResolvedAdapterConfig) {
    super(ctx, 'taskStrategies')
    const meter = ctx.tokenMeter
    this.registry = new StrategyRegistry(text => meter.estimateMessage({
      role: 'user', id: brandString<MessageId>('task-strategy-cost'), source: { kind: 'user' }, content: [{ type: 'text', text }],
    }))
    this.selectionConfig = config.selection
    this.config = structuredClone({ ...config, selection: this.readSelection() })
    this.admission = createAdmission(this.config, ctx.subagents, ctx.agentPresets, ctx.tools)
    for (const [key, value] of Object.entries(config)) {
      if (key.startsWith('max') && (!Number.isSafeInteger(value) || Number(value) <= 0)) {
        throw new Error(`${key} must be a positive safe integer`)
      }
    }
    if (!config.toolPrefix.trim() || !config.provider.trim()) throw new Error('Strategy carrier names must not be empty')
    // The carrier owns admission and registrations; Jobs owns accepted run lifetime.
    ctx.effect(() => async () => {
      this.closing = true
      for (const controller of this.intakes.keys()) controller.abort(new Error('Strategy component is closing'))
      await Promise.allSettled(this.intakes.values())
    }, 'task strategy admission')
    for (const definition of config.strategies) {
      const captured = structuredClone(definition)
      this.register({
        id: captured.id, description: captured.description,
        cost: { plan: captured.plan, variants: captured.variants,
          ...captured.tokenCost === undefined ? {} : { assumptions: captured.tokenCost } },
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

  private readSelection() {
    const config = this.selectionConfig
    const model = config.model.get(), provider = config.provider.get()
    return {
      default: structuredClone(config.default.get()), timeoutMs: config.timeoutMs.get(),
      maxPromptBytes: config.maxPromptBytes.get(), maxOutputBytes: config.maxOutputBytes.get(),
      maxTokens: config.maxTokens.get(),
      ...model === undefined ? {} : { model }, ...provider === undefined ? {} : { provider },
    }
  }

  /**
   * Register an author strategy under the caller's Cordis lifetime.
   * @param strategy - independent decision function, not a plugin declaration.
   * @returns effect-scoped registration disposer.
   */
  register(strategy: AuthorStrategy): () => void {
    if (this.closing) throw new Error('Strategy component is closing')
    // oxlint-disable-next-line typescript/no-misused-promises -- preserve the Cordis effect disposer for registration ownership
    return this.ctx.effect(() => this.registry.register(strategy))
  }

  /**
   * List registered author policies without evaluating them.
   * @param input - optional original task and preferences for task-specific estimates.
   * @returns detached descriptions and child-cost estimates.
   */
  list(input?: StrategyInput): StrategyCatalogEntry[] {
    if (input !== undefined) validateTask(input.task)
    return this.registry.list(input)
  }

  /**
   * Describe the author policies and permitted child compositions.
   * @returns detached strategies and the permitted original DSH preset names.
   */
  @Remote
  catalog(): { strategies: StrategyCatalogEntry[]; presets: string[] } {
    return { strategies: this.list(), presets: [...this.config.allowedPresets] }
  }

  /**
   * Evaluate an author policy and validate its execution choices.
   * @param id - author strategy name.
   * @param input - task and preferences.
   * @returns detached plan; rejects unavailable or disallowed compositions.
   */
  async decide(id: string, input: StrategyInput): Promise<ExecutionPlan> {
    const plan = this.registry.decide(id, input)
    await this.admission.prepare(plan, new AbortController().signal)
    return plan
  }

  /**
   * Submit a named task once per request id under the exact live owner.
   * @param parent - live root Agent owning the original Job.
   * @param request - stable request id, task, strategy and preferences.
   * @param signal - first submitter's admission signal; accepted work uses Jobs cancellation.
   * @returns shared acceptance promise for equal concurrent or repeated requests.
   */
  submit(parent: Agent, request: TaskSubmission, signal: AbortSignal): Promise<TaskReceipt> {
    return this.submitTask(parent, { requestId: request.requestId, task: request.task,
      selection: { kind: 'named', strategy: request.strategy },
      ...request.preferences === undefined ? {} : { preferences: request.preferences },
    }, signal)
  }

  /**
   * Select automatically or honor a named choice before accepting one original Job.
   * @param parent - exact live root Agent owning the request.
   * @param request - stable original id, unchanged task and optional choice.
   * @param signal - first submitter's cancellation until acceptance.
   * @returns shared receipt including the chosen strategy, after selector cleanup.
   */
  submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt> {
    if (this.closing) return Promise.reject(new Error('Strategy component is closing'))
    if (!this.isLiveOwner(parent)) return Promise.reject(new Error('Task requires its exact live owner Agent'))
    const captured = structuredClone(request)
    const store = ownerRuns(this.ctx.jobs, parent)
    const options = this.readSelection()
    const choice = resolveSelection(captured, options.default)
    return reserveSubmission(store, captured, () => {
      const controller = new AbortController()
      const combined = AbortSignal.any([signal, controller.signal])
      const operation = (async (): Promise<TaskReceipt> => {
        this.assertOpen()
        combined.throwIfAborted()
        this.assertLiveOwner(parent)
        const releaseOwner = parent.ctx.effect(() => () => { controller.abort(new Error('Task requires its exact live owner Agent (owner was disposed)')) }, 'task strategy intake')
        try {
          const id = choice.kind === 'named' ? choice.strategy
            : await selectStrategy(parent, this.list(captured), captured, options, this.ctx.subagents, this.config.provider, combined)
          combined.throwIfAborted()
          this.assertOpen()
          this.assertLiveOwner(parent)
          // Reserve metadata space for the original Jobs id and the display-name fallback.
          // Check encoded bytes (including JSON escapes), before author callbacks or Job acceptance.
          if (Buffer.byteLength(JSON.stringify(id), 'utf8') > this.config.maxOutputBytes - 256) {
            throw new Error('Strategy identity exceeds the receipt byte limit')
          }
          const plan = this.registry.decide(id, captured)
          const jobId = await this.startCaptured(parent, captured.task, captureStrategy(id, plan), combined)
          return { jobId, name: plan.name, strategy: id }
        } finally { await releaseOwner() }
      })()
      this.intakes.set(controller, operation)
      return operation.finally(() => { this.intakes.delete(controller) })
    })
  }

  /**
   * Read the committed binding and cumulative state of an owned run.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - accepted task identity, unchanged across switches.
   * @returns detached task view; rejects foreign or unavailable Jobs.
   */
  inspect(parent: Agent, jobId: JobId): TaskRunView {
    return this.ownedRun(parent, jobId).run.inspect()
  }

  /**
   * Reserve replacement by a current named strategy at the next stage barrier.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - accepted task identity.
   * @param request - target strategy, observed binding epoch, preferences and optional explicit stage cursor.
   * @returns reservation command number; inspect state or Job output for commitment or failure.
   */
  requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): number {
    if (this.closing) throw new Error('Strategy component is closing')
    const owned = this.ownedRun(parent, jobId)
    const captured = structuredClone(request)
    const input: StrategyInput = { task: owned.task, ...captured.preferences === undefined ? {} : { preferences: captured.preferences } }
    // Registry.decide captures the registration synchronously, before reload can remove it.
    const registry = this.registry
    return owned.run.requestSwitch(
      () => captureStrategy(captured.strategy, registry.decide(captured.strategy, input)),
      captured,
    )
  }

  /**
   * Continue the retained strategy after a rejected replacement.
   * @param parent - exact live Agent owning the Job.
   * @param jobId - waiting task identity.
   * @param expectedBindingEpoch - binding epoch observed by the caller; stale expectations cannot resume a different binding.
   */
  resume(parent: Agent, jobId: JobId, expectedBindingEpoch: number): void {
    this.ownedRun(parent, jobId).run.resume(expectedBindingEpoch)
  }

  private ownedRun(parent: Agent, jobId: JobId) {
    this.assertLiveOwner(parent)
    this.ctx.jobs.get(jobId, parent.id)
    const owned = ownerRuns(this.ctx.jobs, parent).runs.get(jobId)
    if (owned === undefined) throw new Error(`Unknown task run: ${jobId}`)
    return owned
  }

  private isLiveOwner(parent: Agent): boolean {
    const live = this.ctx.agents.get(parent.id)
    if (live === undefined) return false
    const target = (parent as Agent & { [symbols.original]?: Agent })[symbols.original] ?? parent
    const current = (live as Agent & { [symbols.original]?: Agent })[symbols.original] ?? live
    return target === current
  }

  private assertLiveOwner(parent: Agent): void {
    if (!this.isLiveOwner(parent)) throw new Error('Task requires its exact live owner Agent')
  }

  private assertOpen(): void {
    if (this.closing) throw new Error('Strategy component is closing')
  }

  /**
   * Start an original DSH owned job from an upper-authored or policy-authored plan.
   * @param parent - exact live upper Agent owning the run.
   * @param task - nonblank user task shared with all stages, preserving its whitespace.
   * @param plan - captured execution choices.
   * @param signal - admission cancellation; after acceptance use original job cancellation.
   * @returns original DSH job identity; rejects invalid plans before starting work.
   */
  async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId> {
    return this.startCaptured(parent, task, captureStrategy('explicit', plan), signal)
  }

  private async startCaptured(parent: Agent, task: string, strategy: CapturedStrategy, signal: AbortSignal): Promise<JobId> {
    validateTask(task)
    if (this.closing) throw new Error('Strategy component is closing')
    this.assertLiveOwner(parent)
    const captured = structuredClone(strategy)
    const subagents = this.ctx.subagents
    const jobs = this.ctx.jobs
    const { prepare, checkChild } = this.admission
    const store = ownerRuns(jobs, parent)
    const runConfig = Object.freeze({
      provider: this.config.provider,
      maxConcurrent: this.config.maxConcurrent,
      maxTasks: this.config.maxTasks,
      maxResultBytes: this.config.maxResultBytes,
      maxOutputBytes: this.config.maxOutputBytes,
    })
    await prepare(captured.plan, signal)
    signal.throwIfAborted()
    this.assertOpen()
    this.assertLiveOwner(parent)
    const execute: TaskExecutor = async (step, prompt, childSignal) => {
      // Recheck provider/preset availability at each child admission under the captured rules.
      await checkChild(step, childSignal)
      childSignal.throwIfAborted()
      const run = await subagents.start(runConfig.provider, {
        parent, prompt: [{ type: 'text', text: prompt }], signal: childSignal,
        label: step.label, agentPreset: step.preset,
        ...step.tools === undefined ? {} : { toolFilter: {
          ...step.tools.allow === undefined ? {} : { allow: step.tools.allow },
          ...step.tools.deny === undefined ? {} : { deny: step.tools.deny },
        } },
        ...(step.model === undefined && step.provider === undefined) ? {} : {
          agentOptions: { ...step.model === undefined ? {} : { model: step.model },
            ...step.provider === undefined ? {} : { provider: step.provider } },
        },
      })
      try {
        const result = await run.result
        return { sessionId: run.id, stopReason: result.stopReason,
          output: result.output.filter(block => block.type === 'text').map(block => block.text).join('\n') }
      } finally { await run.dispose() }
    }
    let runtime!: TaskRun
    const jobId = jobs.start({
      kind: 'strategy', label: captured.plan.name, owner: parent.id, outputLimitBytes: runConfig.maxOutputBytes,
      run: (job) => {
        job.append(`Execution plan: ${JSON.stringify(captured.plan)}\n`, { channel: 'log' })
        runtime = new TaskRun(task, captured, execute, {
          maxConcurrent: runConfig.maxConcurrent, maxTasks: runConfig.maxTasks, maxResultBytes: runConfig.maxResultBytes,
          prepare,
          onEvent: (event) => {
            if (event.type === 'stage') job.updateProgress(event.stage)
            job.append(JSON.stringify(event) + '\n', { channel: 'log' })
          },
        })
        const done = runtime.start().then((result): JobOutcome => ({
          status: result.status === 'cancelled' ? 'killed' : result.status,
          ...result.error === undefined ? {} : { detail: boundText(result.error, runConfig.maxOutputBytes) },
          result: boundText(JSON.stringify(result), runConfig.maxOutputBytes),
        }))
        return { cancel: (reason) => { runtime.cancel(new Error(reason ?? 'strategy job cancelled')) }, done }
      },
    })
    store.runs.set(jobId, { task, run: runtime })
    return jobId
  }
}

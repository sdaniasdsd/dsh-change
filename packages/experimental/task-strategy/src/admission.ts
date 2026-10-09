/** Plan admission using captured service handles, independent of the strategy carrier lifetime. */
import type Presets from '@deepseek-ai/dsh-agent-preset-registry'
import type Subagents from '@deepseek-ai/dsh-subagent'
import type Tools from '@deepseek-ai/dsh-tools'
import { validatePlan } from './executor.ts'
import type { AdapterConfig, ExecutionPlan, TaskStep } from './types.ts'

/** Captured plan limits and child capability checks share the same deployment rules. */
export interface PlanAdmission {
  /**
   * Admit a complete plan or stage and release temporary leases.
   * @param plan - detached execution choices.
   * @param signal - cancellation for preparation.
   * @returns settlement after capability checks and lease release.
   */
  readonly prepare: (plan: ExecutionPlan, signal: AbortSignal) => Promise<void>
  /**
   * Recheck a child's selected capabilities without constructing another plan.
   * @param step - task from an admitted stage.
   * @param signal - cancellation for child admission.
   * @returns settlement after capability checks and lease release.
   */
  readonly checkChild: (step: TaskStep, signal: AbortSignal) => Promise<void>
}

/**
 * Capture deployment rules and exact service handles for plan admission.
 * @param config - deployment limits and authorized preset names.
 * @param subagents - provider registry retained by accepted Jobs.
 * @param presets - original preset service.
 * @param tools - original scoped tool registry.
 * @returns asynchronous admission that releases temporary preset leases before settling.
 */
export function createAdmission(
  config: AdapterConfig, subagents: Subagents, presets: Presets, tools: Tools,
): PlanAdmission {
  const captured = structuredClone(config)
  const checkSteps = async (steps: readonly TaskStep[], signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted()
    const { allowedPresets } = captured
    const provider = subagents.getProvider(captured.provider)
    if (provider?.capabilities.agentPreset !== true) throw new Error('Strategy executor requires a preset-selecting subagent provider')
    const names = new Set<string>()
    for (const step of steps) {
      if (!allowedPresets.includes(step.preset)) throw new Error(`Strategy preset is not allowed: ${step.preset}`)
      if (step.tools !== undefined && !provider.capabilities.toolFilter) throw new Error('Strategy provider does not support tool restrictions')
      if ((step.model !== undefined || step.provider !== undefined) && !provider.capabilities.agentOptions) {
        throw new Error('Strategy provider does not support model selection')
      }
      names.add(step.preset)
    }
    for (const name of names) {
      signal.throwIfAborted()
      const preset = await presets.resolve(name)
      signal.throwIfAborted()
      if (preset.broken !== undefined) throw new Error(`Invalid strategy preset ${name}: ${preset.broken}`)
      const filters = steps.flatMap(step => (
        step.preset === name && step.tools !== undefined ? [{ label: step.label, filter: step.tools }] : []
      ))
      if (filters.length === 0) continue
      await using lease = await presets.acquireScope(name)
      signal.throwIfAborted()
      const known = new Set(tools.schemas(lease.key).map(tool => tool.name))
      for (const { label, filter } of filters) {
        const { allow, deny } = filter
        if (allow === undefined && deny === undefined) throw new Error(`Empty tool filter for task ${label}`)
        for (const tool of [...allow ?? [], ...deny ?? []]) {
          if (tool === 'run_code' || !known.has(tool)) throw new Error(`Invalid strategy tool ${tool} for preset ${name}`)
        }
      }
    }
  }
  return {
    prepare: async (plan, signal) => {
      signal.throwIfAborted()
      const { maxConcurrent, maxTasks, maxResultBytes, maxPlanBytes } = captured
      validatePlan(plan, { maxConcurrent, maxTasks, maxResultBytes })
      if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > maxPlanBytes) throw new Error(`Execution plan exceeds byte limit ${maxPlanBytes}`)
      await checkSteps(plan.stages.flatMap(stage => stage.tasks), signal)
    },
    checkChild: (step, signal) => checkSteps([step], signal),
  }
}

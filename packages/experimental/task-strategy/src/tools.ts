/** Model-facing upper-task consumers of the independent strategy component. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type TaskStrategies from './cordis.ts'
import { boundText, parsePlan, parsePreferences } from './schema.ts'

/**
 * Create upper-task tools; the carrier registers them only on non-subagent scopes.
 * @param service - DSH carrier.
 * @param prefix - configured tool-name prefix.
 * @param maxBytes - complete model-facing result byte limit.
 * @returns list, decision preview, and background dispatch definitions.
 */
export function strategyTools(service: TaskStrategies, prefix: string, maxBytes: number): ToolDefinition[] {
  const output = { schema: { type: 'string' as const }, render: (_args: object, value: string) => [{ type: 'text' as const, text: value }] }
  return [
    defineTool({
      name: `${prefix}_list`,
      description: 'List author-defined execution strategies. Strategies decide child workflows, plugin presets, and capabilities; they are not plugins.',
      parameters: {}, output,
      async execute() { return boundText(JSON.stringify(service.catalog()), maxBytes) },
    }),
    defineTool({
      name: `${prefix}_plan`,
      description: 'Preview an author strategy decision without starting any task. Inspect returned stages and child presets before dispatch.',
      parameters: {
        strategy: { type: 'string', required: true }, task: { type: 'string', required: true },
        preferences: { type: 'json', description: 'Optional object mapping author preference names to string values.' },
      }, output,
      async execute(args) {
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const plan = await service.decide(args.strategy, { task: args.task, ...preferences === undefined ? {} : { preferences } })
        return boundText(JSON.stringify(plan), maxBytes)
      },
    }),
    defineTool({
      name: `${prefix}_run`,
      description: 'Dispatch a task using exactly one of an author strategy or your explicit execution plan. '
        + 'Stages run in order; tasks within a stage may run concurrently. Failed children stop the plan. '
        + 'Choose allowed DSH presets. Use job_output/job_list for progress and job_kill to cancel. Concurrent tasks share files.',
      parameters: {
        task: { type: 'string', required: true }, strategy: { type: 'string' },
        plan: { type: 'json', description: 'Explicit upper-authored execution plan; omit strategy when providing this.' },
        preferences: { type: 'json', description: 'String-valued author preferences for a named strategy.' },
      }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Strategy dispatch requires a calling agent')
        if ((args.strategy === undefined) === (args.plan === undefined)) throw new Error('Provide exactly one of strategy or plan')
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const plan = args.strategy !== undefined
          ? await service.decide(args.strategy, { task: args.task, ...preferences === undefined ? {} : { preferences } })
          : parsePlan(args.plan)
        const jobId = await service.start(exec.agent, args.task, plan, exec.signal)
        const receipt = { jobId, name: plan.name, status: 'running', progress: 'job_output', cancel: 'job_kill' }
        const text = JSON.stringify(receipt)
        return Buffer.byteLength(text, 'utf8') <= maxBytes ? text : JSON.stringify({
          ...receipt, name: '[truncated; plan name exceeds output limit]',
        })
      },
    }),
  ]
}

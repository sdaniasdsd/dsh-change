/** Model-facing upper-task consumers of the independent strategy component. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type TaskStrategies from './cordis.ts'
import { boundText, parsePlan, parsePreferences } from './schema.ts'

function receiptText(receipt: { jobId: string; name: string }, maxBytes: number): string {
  const text = JSON.stringify(receipt)
  // Identity fields are never sliced. The original Jobs service issues compact kind/ordinal ids.
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  const shortened = JSON.stringify({
    ...receipt, name: '[truncated; plan name exceeds output limit]',
  })
  if (Buffer.byteLength(shortened, 'utf8') <= maxBytes) return shortened
  // A retained receipt can outlive a carrier with a larger limit. Refuse presentation,
  // while leaving the accepted Job and its original reservation intact.
  throw new Error(`Task ${receipt.jobId} is already accepted; receipt identity exceeds the current output byte limit. `
    + 'Use job_output for this Job or restore the previous output limit and retry the same request.')
}

/**
 * Create upper-task tools; the carrier registers them only on non-subagent scopes.
 * @param service - DSH carrier.
 * @param prefix - configured tool-name prefix.
 * @param maxBytes - complete model-facing result byte limit.
 * @returns catalogue, preview, direct dispatch and original-request intake definitions.
 */
export function strategyTools(service: TaskStrategies, prefix: string, maxBytes: number): ToolDefinition[] {
  const output = { schema: { type: 'string' as const }, render: (_args: object, value: string) => [{ type: 'text' as const, text: value }] }
  return [
    defineTool({
      name: `${prefix}_submit`,
      description: 'Submit the original task once using a stable requestId. Omit strategy to use the configured automatic or named default; '
        + 'provide strategy to honor a user choice. Automatic selection needs no user reply. '
        + 'If useful, ask the user with the original timed ask_user_question tool before submitting; a pending or skipped reply uses the default. '
        + 'A late reply must not create another request id or execute this task again. '
        + 'Reuse the same requestId and input when retrying a tool call. Use job_output for results and job_kill to cancel accepted work.',
      parameters: {
        requestId: { type: 'string', required: true }, task: { type: 'string', required: true },
        strategy: { type: 'string', description: 'Optional registered strategy id chosen by the user.' },
        preferences: { type: 'json', description: 'Optional object mapping author preference names to string values.' },
      }, output,
      async execute(args, exec) {
        if (exec.agent === undefined) throw new Error('Strategy submission requires a calling agent')
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const receipt = await service.submitTask(exec.agent, { requestId: args.requestId, task: args.task,
          ...args.strategy === undefined ? {} : { selection: { kind: 'named', strategy: args.strategy } },
          ...preferences === undefined ? {} : { preferences },
        }, exec.signal)
        return receiptText(receipt, maxBytes)
      },
    }),
    defineTool({
      name: `${prefix}_list`,
      description: 'List author-defined strategies and explainable child token estimates. Provide the original task and preferences '
        + 'for task-specific estimates; omitted task gives registration baselines. Known input excludes unknown context and outputs. '
        + 'Scenario totals require explicit assumptions. Unknown cost is not zero. Choose a suitable workflow before comparing costs.',
      parameters: { task: { type: 'string', description: 'Optional original task for refining token estimates.' },
        preferences: { type: 'json', description: 'Optional string-valued preferences; requires task.' } }, output,
      execute(args) {
        if (args.task === undefined && args.preferences !== undefined) throw new Error('Cost preferences require the original task')
        const preferences = args.preferences === undefined ? undefined : parsePreferences(args.preferences)
        const catalogue = args.task === undefined ? service.catalog() : {
          ...service.catalog(), strategies: service.list({ task: args.task, ...preferences === undefined ? {} : { preferences } }),
        }
        return Promise.resolve(boundText(JSON.stringify(catalogue), maxBytes))
      },
    }),
    defineTool({
      name: `${prefix}_plan`,
      description: 'Preview an author strategy decision without starting any task. Inspect the returned stages and child presets before dispatch.',
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
        + 'Plan format: {name, stages:[{name,tasks:[{label,preset,instruction,tools?:{allow?:string[],deny?:string[]},model?,provider?}]}]}. '
        + 'Stages run in order; tasks within a stage may run concurrently. Failed children stop the plan. '
        + 'Choose declared, allowed DSH presets for plugin compositions. Use job_output/job_list for progress and job_kill to cancel. Concurrent tasks share files.',
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
        return receiptText(receipt, maxBytes)
      },
    }),
  ]
}

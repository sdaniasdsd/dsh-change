/** Explainable strategy-child estimates; no model calls or author callbacks. */
import { taskPrompt } from './task-prompt.ts'
import type { ExecutionPlan, StrategyTokenCost, TokenCostAssumptions, TokenCostUnknown } from './types.ts'

/**
 * Price known prompts and an optional explicitly configured usage scenario.
 * @param plan - detached declarative plan.
 * @param task - original task, or empty text for registration.
 * @param basis - registration baseline or task-specific estimate.
 * @param measure - owner's message-framed text estimator.
 * @param assumptions - optional expected calls, extra context and outputs.
 * @returns detached costing data with uncertainty; rejects invalid assumptions and unsafe arithmetic.
 */
export function estimatePlanCost(
  plan: ExecutionPlan, task: string, basis: 'registration' | 'task', measure: (text: string) => number,
  assumptions?: TokenCostAssumptions,
): StrategyTokenCost {
  if (assumptions !== undefined) {
    for (const [key, value] of Object.entries(assumptions)) {
      if (!Number.isSafeInteger(value) || value < (key === 'callsPerTask' ? 1 : 0)) {
        throw new Error(`Token cost ${key} must be a ${key === 'callsPerTask' ? 'positive' : 'nonnegative'} safe integer`)
      }
    }
  }
  let knownInputTokens = 0, tasks = 0, transferredOutputs = 0
  const prior: { stage: string; label: string; stopReason: string; output: string }[] = []
  for (const stage of plan.stages) {
    for (const step of stage.tasks) {
      const measured = measure(taskPrompt(task, step.instruction, JSON.stringify(prior)))
      if (!Number.isSafeInteger(measured) || measured < 0) throw new Error('Token cost estimate exceeds safe integer range')
      knownInputTokens += measured
      transferredOutputs += prior.length
      tasks++
    }
    for (const step of stage.tasks) prior.push({ stopReason: 'completed', output: '', stage: stage.name, label: step.label })
  }
  if (!Number.isSafeInteger(knownInputTokens)) throw new Error('Token cost estimate exceeds safe integer range')
  const unknowns: TokenCostUnknown[] = ['reasoning', 'tokenizer-and-cache', 'selector-and-parent', 'result-metadata-variance']
  if (basis === 'registration') unknowns.push('task-body')
  const common = { kind: 'estimated' as const, basis, planName: plan.name, tasks, stages: plan.stages.length, knownInputTokens }
  if (assumptions === undefined) {
    unknowns.push('system-and-tools', 'model-turns', 'outputs-and-transfer')
    return { ...common, unknowns }
  }
  const { callsPerTask, contextTokensPerCall, outputTokensPerCall } = assumptions
  const estimatedInputTokens = callsPerTask * (knownInputTokens + tasks * contextTokensPerCall + transferredOutputs * outputTokensPerCall)
  const estimatedOutputTokens = tasks * callsPerTask * outputTokensPerCall
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens
  for (const value of [knownInputTokens, estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Token cost estimate exceeds safe integer range')
  }
  unknowns.push('tool-output-variance')
  return { ...common, unknowns, assumptions: structuredClone(assumptions),
    estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens }
}

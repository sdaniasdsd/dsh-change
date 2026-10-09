/** Capture author plans as data and advance them without owning task results or resources. */
import { createHash } from 'node:crypto'
import type { CapturedStrategy } from './runtime-types.ts'
import type { ExecutionPlan } from './types.ts'

interface SingleStagePlan extends ExecutionPlan {
  readonly stages: [ExecutionPlan['stages'][number]]
}

/**
 * Detach a resolved author plan and identify its exact data revision.
 * @param id - author strategy name, or a caller-provided explicit-plan name.
 * @param plan - resolved static plan; no author function is retained.
 * @returns plan snapshot with a content revision.
 */
export function captureStrategy(id: string, plan: ExecutionPlan): CapturedStrategy {
  const captured = structuredClone(plan)
  return { id, revision: createHash('sha256').update(JSON.stringify(captured)).digest('hex'), plan: captured }
}

/**
 * Select one stage for admission without sharing the strategy's mutable data.
 * @param strategy - captured strategy data.
 * @param index - explicit zero-based cursor; names are never used to infer completed work.
 * @returns a detached single-stage plan, or undefined at the end of the plan.
 */
export function selectStage(strategy: CapturedStrategy, index: number): SingleStagePlan | undefined {
  if (!Number.isSafeInteger(index) || index < 0 || index > strategy.plan.stages.length) {
    throw new Error(`Invalid strategy stage index: ${index}`)
  }
  const stage = strategy.plan.stages[index]
  if (stage === undefined) return undefined
  const plan: SingleStagePlan = { name: strategy.plan.name, stages: [stage] }
  return structuredClone(plan)
}

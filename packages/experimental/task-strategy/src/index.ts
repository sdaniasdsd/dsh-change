/** Independent author strategy registry. Cordis integration lives in ./cordis.ts. */
import type { AuthorStrategy, ExecutionPlan, StrategyInput } from './types.ts'
export type * from './types.ts'
export { executePlan, validatePlan } from './executor.ts'

/** Names author decisions without modifying DSH's plugin registry. */
export class StrategyRegistry {
  private readonly strategies = new Map<string, AuthorStrategy>()

  /**
   * Register an author decision, rejecting empty or duplicate names.
   * @param strategy - author-owned decision function.
   * @returns idempotent disposer for this registration only.
   */
  register(strategy: AuthorStrategy): () => void {
    if (!strategy.id.trim()) throw new Error('Strategy id must not be empty')
    if (this.strategies.has(strategy.id)) throw new Error(`Duplicate strategy: ${strategy.id}`)
    const registered = { id: strategy.id, description: strategy.description, decide: strategy.decide.bind(strategy) }
    this.strategies.set(strategy.id, registered)
    return () => {
      if (this.strategies.get(registered.id) === registered) this.strategies.delete(registered.id)
    }
  }

  /**
   * List author policies without invoking their decision functions.
   * @returns detached descriptions of registered author decisions.
   */
  list(): { id: string; description: string }[] {
    return [...this.strategies.values()].map(({ id, description }) => ({ id, description }))
  }

  /**
   * Decide with detached input; removal does not revoke an in-flight decision.
   * @param id - registered strategy name.
   * @param input - task and author preferences.
   * @returns a detached execution plan; rejects unknown strategies and author errors.
   */
  async decide(id: string, input: StrategyInput): Promise<ExecutionPlan> {
    const strategy = this.strategies.get(id)
    if (strategy === undefined) throw new Error(`Unknown strategy: ${id}`)
    return structuredClone(await strategy.decide(structuredClone(input)))
  }
}

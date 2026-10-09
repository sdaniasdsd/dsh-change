/** Intake choices and bounds, shared by the host contract and configuration. */
import type { StrategyInput } from './types.ts'

/** Automatic choice uses one bounded model call; named choice bypasses it. */
export type TaskSelection = { readonly kind: 'auto' } | { readonly kind: 'named'; readonly strategy: string }

/** Original request identity is retained even when the default choice changes. */
export interface TaskIntakeRequest extends StrategyInput {
  readonly requestId: string
  readonly selection?: TaskSelection
}

/** Limits belong only to selection; execution retains its separate limits. */
export interface SelectorOptions {
  readonly timeoutMs: number
  readonly maxPromptBytes: number
  readonly maxOutputBytes: number
  readonly maxTokens: number
  readonly model?: string
  readonly provider?: string
}

/** User-editable defaults for later task intake. */
export interface SelectionConfig extends SelectorOptions {
  readonly default: TaskSelection
}

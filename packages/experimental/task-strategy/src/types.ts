/** Author decisions and executor inputs, independent of Cordis and DSH plugins. */
import type { SelectionConfig } from './selection-types.ts'

/** Input shared with an author-written decision function. */
export interface StrategyInput {
  /** Nonblank task body; accepted text preserves the caller's whitespace. */
  readonly task: string
  readonly preferences?: Readonly<Record<string, string>>
}

/** One child task's instructions and selected capabilities. */
export interface TaskStep {
  readonly label: string
  readonly preset: string
  readonly instruction: string
  readonly tools?: { readonly allow?: string[] | undefined; readonly deny?: string[] | undefined } | undefined
  readonly model?: string | undefined
  readonly provider?: string | undefined
}

/** Sequential stages, with concurrent children inside each stage. */
export interface ExecutionPlan {
  readonly name: string
  readonly stages: { readonly name: string; readonly tasks: TaskStep[] }[]
}

/** A trusted, finite synchronous plan decision; asynchronous work belongs to the executor. */
export interface AuthorStrategy {
  readonly id: string
  readonly description: string
  /** Declarative costing data; absent for an opaque dynamic plan. Never invokes decide. */
  readonly cost?: StrategyCostDeclaration
  decide(input: StrategyInput): ExecutionPlan
}

/** Explicit scenario assumptions, not execution limits or measured usage. */
export interface TokenCostAssumptions {
  /** Expected model calls per child, including its final response. */
  readonly callsPerTask: number
  /** Additional system, tool and within-child history tokens per model call. */
  readonly contextTokensPerCall: number
  /** Expected output per model call; the final response is forwarded between stages. */
  readonly outputTokensPerCall: number
}

/** Static plans used solely for costing without evaluating author code. */
export interface StrategyCostDeclaration {
  readonly plan: ExecutionPlan
  readonly variants?: StrategyDefinition['variants']
  readonly assumptions?: TokenCostAssumptions
}

/** Uncertainty visible to the selector and user; never a billing claim. */
export type TokenCostUnknown = 'task-body' | 'system-and-tools' | 'model-turns' | 'outputs-and-transfer'
  | 'tool-output-variance' | 'reasoning' | 'tokenizer-and-cache' | 'selector-and-parent' | 'result-metadata-variance'

/** Child-cost data excluding parent/selector costs; known input uses the injected text heuristic. */
export type StrategyTokenCost = { readonly kind: 'unknown'; readonly reason: 'dynamic-plan' | 'estimator-unavailable' } | {
  readonly kind: 'estimated'
  readonly basis: 'registration' | 'task'
  readonly planName: string
  readonly tasks: number
  readonly stages: number
  /** Known task/instruction/framing tokens, once per child; excludes unknown prior outputs. */
  readonly knownInputTokens: number
  readonly unknowns: readonly TokenCostUnknown[]
  readonly assumptions?: TokenCostAssumptions
  readonly estimatedInputTokens?: number
  readonly estimatedOutputTokens?: number
  readonly estimatedTotalTokens?: number
}

/** Detached registered-policy description and costing data. */
export interface StrategyCatalogEntry {
  readonly id: string
  readonly description: string
  readonly cost: StrategyTokenCost
}

/** A settled child, after its executor has released all resources. */
export interface ChildResult {
  readonly sessionId?: string
  readonly stopReason: string
  readonly output: string
}

/** Executor must honor cancellation and resolve only after child cleanup. */
export type TaskExecutor = (task: TaskStep, prompt: string, signal: AbortSignal) => Promise<ChildResult>

/** Child output labelled for later stages and the caller. */
export interface TaskResult extends ChildResult {
  readonly stage: string
  readonly label: string
}

/** Best-effort live progress; observers do not own execution. */
export type ExecutionEvent =
  | { readonly type: 'stage'; readonly stage: string }
  | { readonly type: 'task-start'; readonly stage: string; readonly label: string; readonly preset: string }
  | { readonly type: 'task-end'; readonly stage: string; readonly label: string; readonly stopReason: string; readonly sessionId?: string }

/** Validated per-run limits and caller cancellation. */
export interface ExecutionOptions {
  readonly maxConcurrent: number
  readonly maxTasks: number
  readonly maxResultBytes: number
  readonly signal: AbortSignal
  readonly onEvent?: (event: ExecutionEvent) => void
}

/** Terminal execution outcome; completed does not mean independently verified. */
export interface ExecutionResult {
  readonly status: 'completed' | 'failed' | 'cancelled'
  readonly results: TaskResult[]
  readonly error?: string
}

/** Declarative author policy with optional preference-selected alternatives. */
export interface StrategyDefinition {
  readonly id: string
  readonly description: string
  readonly plan: ExecutionPlan
  readonly variants?: { readonly preference: string; readonly equals: string; readonly plan: ExecutionPlan }[]
  /** Optional scenario assumptions; no hidden output or turn defaults. */
  readonly tokenCost?: TokenCostAssumptions
}

/** DSH carrier configuration; these settings do not alter the plugin registry. */
export interface AdapterConfig {
  readonly selection: SelectionConfig
  readonly provider: string
  readonly toolPrefix: string
  readonly allowedPresets: string[]
  readonly strategies: StrategyDefinition[]
  readonly maxConcurrent: number
  readonly maxTasks: number
  readonly maxPlanBytes: number
  readonly maxResultBytes: number
  readonly maxOutputBytes: number
}

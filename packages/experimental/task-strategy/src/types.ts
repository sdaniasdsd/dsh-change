/** Author decisions and executor inputs, independent of Cordis and DSH plugins. */

/** Input shared with an author-written decision function. */
export interface StrategyInput {
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

/** A named author policy, not a DSH plugin declaration. */
export interface AuthorStrategy {
  readonly id: string
  readonly description: string
  decide(input: StrategyInput): ExecutionPlan | Promise<ExecutionPlan>
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
}

/** DSH carrier configuration; these settings do not alter the plugin registry. */
export interface AdapterConfig {
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

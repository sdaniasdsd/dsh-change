# 任务策略

[English](task-strategy.md) | 中文

实验性的 task-strategy 库将作者的工作流决策与 DSH 插件身份分开。它的可选 Cordis 载体仅通过显式 profile patch 加载。启用后，`ctx.taskStrategies` 会校验有序计划，并通过 DSH 现有的 preset、subagent 和 Jobs 服务分发各个下层任务；下层 agent 不会获得策略控制工具。

阶段按顺序执行，同一阶段内的任务可以并发。分发前会检查预设与工具过滤器，进度记入 DSH 自有 job。卸载载体会移除其注册，但已接收的 Job 继续遵循 Jobs 服务的生命周期；需要显式取消时使用 `job_kill`。并发任务仍可能共享文件，因此作者需要协调写入。任务轮次结束仅表示子任务已结束，不代表其输出经过独立验证。

计划格式和 profile patch 示例见[包文档](../../packages/experimental/task-strategy/README.zh.md)。

`AuthorStrategy.decide` 和 `StrategyRegistry.decide` 同步生成独立的计划数据，异步工作归执行层管理。载体的 `ctx.taskStrategies.decide` 还执行准入，因此仍为异步。作者要求见包文档。

宿主调用方可以用所属 Agent 范围内的 `requestId` 提交命名策略，读取任务保留的状态，并在阶段排空后的边界请求替换。替换期间 JobId 保持固定，已有结果和累计子任务额度继续保留；替换失败时等待明确恢复或再次切换。宿主控制及进程内状态定义见 [runtime-types.ts](../../packages/experimental/task-strategy/src/runtime-types.ts)，根模型工具提供提交、列出、计划和执行。

| 类型 | 宿主职责 |
|---|---|
| `TaskSubmission` | 一次接收的请求 id、任务输入、策略及偏好 |
| `TaskIntakeRequest` | 原始请求 id、任务及可选的自动或指定策略；省略选择时捕获插件默认值 |
| `TaskReceipt` | 已接收的 JobId、初始计划名及所选策略，不是完成报告 |
| `TaskSwitch` | 目标策略、已观察到的绑定版本、偏好和显式的零基起始游标 |
| `TaskRunView` | 已提交绑定、阶段、保留结果、累计用量及待处理切换 |

在保留同一模块和 Jobs 服务时重新挂载载体会保留活跃任务，进程重启不会。已接收任务的部署规则保持固定，提供方和预设的可用性则在准入时检查。尚未实现的原生输入路由与持久化见包文档的[限制说明](../../packages/experimental/task-strategy/README.zh.md#known-limitations-and-deferred-work)。

切换与恢复命令要求调用方观察到的 `binding.epoch`。运行时在执行作者函数或改变任务状态之前拒绝过期的预期值，载体不会替换成最新版本。参见[绑定命令升级指南](../upgrade-guide/v0.2.0-rc.2/task-strategy-binding-commands/guide.zh.md)。

`submitTask` 在预留原始请求标识后进行自动选择，或按指定策略直接规划。自动选择使用原版子 Agent 的结构化捕获，清理完成后才创建所属 Job；选择失败不静默改用其他策略。用户可先通过原版限时提问选择，未答复仍可继续，迟到答复不重复任务。原版插件页的“任务策略”提供默认模式、路由和截止时间设置。见[选择升级指南](../upgrade-guide/v0.2.0-rc.2/task-strategy-selection/guide.zh.md)。

目录条目包含可解释的子任务 Token 成本。注册表在注册时估算声明式计划，原任务与偏好可细化估算而不执行作者函数。可选场景假设估算预期调用、额外上下文和输出传递。选择器接收任务目录，插件页展示基线成本与未知项。未知成本不是零，不计入父任务与选择器用量。参见[估算契约](../../packages/experimental/task-strategy/README.zh.md#token-estimates)与[迁移说明](../upgrade-guide/v0.2.0-rc.2/task-strategy-cost-catalog/guide.zh.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskstrategies--taskstrategies"></a>

### `ctx.taskStrategies` — `TaskStrategies`

DSH integration; author strategy identities remain outside the plugin registry.

```ts cordis-catalog
/**
 * Register an author strategy under the caller's Cordis lifetime.
 * @param strategy - independent decision function, not a plugin declaration.
 * @returns effect-scoped registration disposer.
 */
register(strategy: AuthorStrategy): () => void

/**
 * List registered author policies without evaluating them.
 * @param input - optional original task and preferences for task-specific estimates.
 * @returns detached descriptions and child-cost estimates.
 */
list(input?: StrategyInput): StrategyCatalogEntry[]

/**
 * Describe the author policies and permitted child compositions.
 * @returns detached strategies and the permitted original DSH preset names.
 */
@Remote catalog(): { strategies: StrategyCatalogEntry[]; presets: string[] }

/**
 * Evaluate an author policy and validate its execution choices.
 * @param id - author strategy name.
 * @param input - task and preferences.
 * @returns detached plan; rejects unavailable or disallowed compositions.
 */
async decide(id: string, input: StrategyInput): Promise<ExecutionPlan>

/**
 * Submit a named task once per request id under the exact live owner.
 * @param parent - live root Agent owning the original Job.
 * @param request - stable request id, task, strategy and preferences.
 * @param signal - first submitter's admission signal; accepted work uses Jobs cancellation.
 * @returns shared acceptance promise for equal concurrent or repeated requests.
 */
submit(parent: Agent, request: TaskSubmission, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Select automatically or honor a named choice before accepting one original Job.
 * @param parent - exact live root Agent owning the request.
 * @param request - stable original id, unchanged task and optional choice.
 * @param signal - first submitter's cancellation until acceptance.
 * @returns shared receipt including the chosen strategy, after selector cleanup.
 */
submitTask(parent: Agent, request: TaskIntakeRequest, signal: AbortSignal): Promise<TaskReceipt>

/**
 * Read the committed binding and cumulative state of an owned run.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity, unchanged across switches.
 * @returns detached task view; rejects foreign or unavailable Jobs.
 */
inspect(parent: Agent, jobId: JobId): TaskRunView

/**
 * Reserve replacement by a current named strategy at the next stage barrier.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - accepted task identity.
 * @param request - target strategy, observed binding epoch, preferences and optional explicit stage cursor.
 * @returns reservation command number; inspect state or Job output for commitment or failure.
 */
requestSwitch(parent: Agent, jobId: JobId, request: TaskSwitch): number

/**
 * Continue the retained strategy after a rejected replacement.
 * @param parent - exact live Agent owning the Job.
 * @param jobId - waiting task identity.
 * @param expectedBindingEpoch - binding epoch observed by the caller; stale expectations cannot resume a different binding.
 */
resume(parent: Agent, jobId: JobId, expectedBindingEpoch: number): void

/**
 * Start an original DSH owned job from an upper-authored or policy-authored plan.
 * @param parent - exact live upper Agent owning the run.
 * @param task - nonblank user task shared with all stages, preserving its whitespace.
 * @param plan - captured execution choices.
 * @param signal - admission cancellation; after acceptance use original job cancellation.
 * @returns original DSH job identity; rejects invalid plans before starting work.
 */
async start(parent: Agent, task: string, plan: ExecutionPlan, signal: AbortSignal): Promise<JobId>
```

Types: [Agent](core.zh.md) · [JobId](jobs.zh.md)

Source: [`packages/experimental/task-strategy/src/cordis.ts`](../../packages/experimental/task-strategy/src/cordis.ts)
<!-- END GENERATED cordis-surface -->

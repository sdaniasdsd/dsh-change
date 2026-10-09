/** Locale-owned copy for the task strategy plugin page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TokenCostUnknown } from '../types.ts'

/** Copy rendered by this page. */
export type TaskStrategyLocaleKey =
  | 'title' | 'description' | 'mode' | 'auto' | 'named' | 'noReply' | 'strategy' | 'unknown'
  | 'model' | 'provider' | 'inherit' | 'timeout' | 'timeoutHint' | 'catalog' | 'loading' | 'catalogError' | 'empty' | 'retry'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalid'
  | 'costKnown' | 'costTotal' | 'costTasks' | 'costUnknown' | 'costNote' | 'costAssumptions'
  | 'costDynamic' | 'costUnavailable' | 'costUnknowns' | 'costTaskBody' | 'costSystemTools' | 'costTurns'
  | 'costOutputs' | 'costToolVariance' | 'costReasoning' | 'costTokenizerCache' | 'costParent' | 'costMetadata'

/** Localized uncertainty labels keyed by the Host discriminants. */
export const costUnknownKeys: Record<TokenCostUnknown, TaskStrategyLocaleKey> = {
  'task-body': 'costTaskBody', 'system-and-tools': 'costSystemTools', 'model-turns': 'costTurns',
  'outputs-and-transfer': 'costOutputs', 'tool-output-variance': 'costToolVariance', 'reasoning': 'costReasoning',
  'tokenizer-and-cache': 'costTokenizerCache', 'selector-and-parent': 'costParent', 'result-metadata-variance': 'costMetadata',
}

/** English copy. */
export const en: Record<TaskStrategyLocaleKey, string> = {
  title: 'Task strategies', description: 'Choose how each task is planned and executed.',
  mode: 'Default choice', auto: 'Automatic', named: 'Use a strategy', noReply: 'Automatic choice can continue without a user reply. Each task can override this default.',
  strategy: 'Strategy id', unknown: 'This strategy is not in the current catalogue. New submissions will refuse it.',
  model: 'Selection model', provider: 'Model provider', inherit: 'Leave blank to inherit the task Agent’s route.',
  timeout: 'Selection deadline (ms)', timeoutHint: 'Selection errors or deadline expiry stop submission before an execution task is created.',
  catalog: 'Available strategies', loading: 'Loading strategies…', catalogError: 'Could not load strategies.', empty: 'No strategies registered.', retry: 'Refresh strategies',
  overridden: 'Overridden', reset: 'Reset to default', readOnly: 'This deployment stores settings read-only.', unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save', saving: 'Saving…', saveFailed: 'The deployment did not accept these values; the draft is retained. Reload the page if another editor changed the settings.',
  invalid: 'Enter a valid value.',
  costKnown: 'Known input tokens', costTotal: 'Scenario total tokens', costTasks: 'Child tasks / stages',
  costUnknown: 'Cost unknown', costAssumptions: 'Calls per child / extra context per call / output per call',
  costDynamic: 'Dynamic plan has no declared costing plan', costUnavailable: 'No token estimator available', costUnknowns: 'Unpriced or uncertain',
  costTaskBody: 'Task body', costSystemTools: 'System prompt and tool schemas', costTurns: 'Model calls',
  costOutputs: 'Outputs and transfer', costToolVariance: 'Tool results and history growth', costReasoning: 'Reasoning tokens',
  costTokenizerCache: 'Tokenizer and cache effects', costParent: 'Parent and selector', costMetadata: 'Session ids and result JSON escaping',
  costNote: 'Registration estimate excludes the task body. Actual turns, tool results, reasoning and cache vary; parent and selector costs are excluded.',
}

/** Simplified Chinese copy. */
export const zh: Record<TaskStrategyLocaleKey, string> = {
  title: '任务策略', description: '选择每个任务的规划与执行方式。',
  mode: '默认选择方式', auto: '自动选择', named: '指定策略', noReply: '自动选择无需等待用户答复。每个任务仍可单独指定策略。',
  strategy: '策略标识', unknown: '当前目录中没有该策略，新提交会拒绝使用它。',
  model: '选择模型', provider: '模型提供方', inherit: '留空继承任务 Agent 的模型路由。',
  timeout: '选择截止时间（毫秒）', timeoutHint: '选择失败或超时会停止提交，不创建执行任务。',
  catalog: '可用策略', loading: '正在加载策略…', catalogError: '无法加载策略。', empty: '尚未注册策略。', retry: '刷新策略',
  overridden: '已覆盖', reset: '恢复默认', readOnly: '本部署的设置为只读。', unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存', saving: '保存中…', saveFailed: '本部署未接受这些值，草稿已保留。如果其他编辑者修改了设置，请重新打开页面。',
  invalid: '请输入有效值。',
  costKnown: '已知输入 Token', costTotal: '情景总 Token 估算', costTasks: '子任务数 / 阶段数',
  costUnknown: '成本未知', costAssumptions: '每任务调用数 / 每次额外上下文 / 每次输出',
  costDynamic: '动态策略未声明估算用计划', costUnavailable: '尚无 Token 估算器', costUnknowns: '未计入或不确定项',
  costTaskBody: '任务正文', costSystemTools: '系统提示与工具定义', costTurns: '模型调用数',
  costOutputs: '输出及阶段间传递', costToolVariance: '工具返回与历史增长', costReasoning: '推理 Token',
  costTokenizerCache: '分词与缓存影响', costParent: '父任务与选择器', costMetadata: '会话标识与结果 JSON 转义',
  costNote: '注册估算不含任务正文。实际轮数、工具结果、推理和缓存会变化；不含父任务与选择器成本',
}

/**
 * Supply the original form frame's localized labels.
 * @param t - this page's locale reader.
 * @returns labels for the shared settings form.
 */
export function formLabels(t: (key: TaskStrategyLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}

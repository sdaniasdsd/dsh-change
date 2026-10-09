/** Staged selector preferences and one generation-fenced Host catalogue. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SettingsFormModel, settingsTextField, settingsNumberField,
  type SettingsFormScope, type SettingsFormActions, type SettingsFormShell, type SettingsFieldState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SelectionConfig, TaskSelection } from '../selection-types.ts'
import type { StrategyTokenCost } from '../types.ts'

/** Entry id used by the opt-in source overlay and its configuration page. */
export const TASK_STRATEGY_NS = 'experimental-task-strategy'

/** Only the selector preferences are editable on this page. */
export interface TaskStrategySettings { readonly selection: SelectionConfig }

/** Read-only Host catalogue; no task controls cross this browser contract. */
export interface StrategyCatalog {
  readonly strategies: { id: string; description: string; cost?: StrategyTokenCost }[]
  readonly presets: string[]
}

/** Snapshot rendered by the original Plugins page. */
export interface TaskStrategyCardState extends SettingsFormShell {
  readonly choice: TaskSelection | undefined
  readonly default: SettingsFieldState
  readonly model: SettingsFieldState
  readonly provider: SettingsFieldState
  readonly timeoutMs: SettingsFieldState
  readonly strategies: StrategyCatalog['strategies']
  readonly catalogStatus: 'idle' | 'loading' | 'ready' | 'error'
}

/** Actions and framework-bound snapshot for the card. */
export interface TaskStrategyCardFace extends SettingsFormActions {
  readonly hooks: { readonly taskStrategyCard: SnapshotStore<TaskStrategyCardState> }
  readonly choose: (choice: TaskSelection) => void
  readonly retryCatalog: () => void
  readonly activateCatalog: () => void
}

function section(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'selection' in value ? value.selection : undefined
}

function choice(text: string): TaskSelection | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch (_error) { return undefined }
  if (value === null || typeof value !== 'object' || !('kind' in value)) return undefined
  if (value.kind === 'auto') return { kind: 'auto' }
  if (value.kind === 'named' && 'strategy' in value && typeof value.strategy === 'string') return { kind: 'named', strategy: value.strategy }
  return undefined
}

/** Reuses the original form write queue and revision fence for nested selector fields. */
export class TaskStrategyCardController {
  private readonly form: SettingsFormModel<SelectionConfig>
  private readonly store: SnapshotStore<TaskStrategyCardState>
  private readonly unsubscribe: () => void
  private readonly face: TaskStrategyCardFace
  private strategies: StrategyCatalog['strategies'] = []
  private catalogStatus: TaskStrategyCardState['catalogStatus'] = 'idle'
  private generation = 0
  private disposed = false

  /**
   * @param scope - Host entry configuration, including its original revision.
   * @param readCatalog - only Host catalogue operation; rejects unavailable reads.
   */
  constructor(
    private readonly scope: SettingsFormScope<TaskStrategySettings>, private readonly readCatalog: () => Promise<StrategyCatalog>,
  ) {
    const selectionScope: SettingsFormScope<SelectionConfig> = {
      getSnapshot: () => {
        const snapshot = scope.getSnapshot()
        return { ...snapshot, value: snapshot.value?.selection, base: section(snapshot.base), user: section(snapshot.user) }
      },
      subscribe: listener => scope.subscribe(listener),
      mutate: (ops, revision) => scope.mutate(ops.map(op => ({ ...op, path: ['selection', ...op.path] })), revision),
    }
    this.form = new SettingsFormModel(selectionScope, [
      { field: 'default', format: value => value === undefined ? '' : JSON.stringify(value), parse: (text) => {
        const parsed = choice(text)
        return parsed !== undefined && (parsed.kind === 'auto' || parsed.strategy.trim() !== '') ? { kind: 'set', value: parsed } : undefined
      } },
      settingsTextField('model'), settingsTextField('provider'), settingsNumberField('timeoutMs'),
    ])
    this.store = this.form.bind(() => this.projection())
    const actions = this.form.actions()
    this.face = { ...actions, hooks: { taskStrategyCard: this.store },
      choose: (value) => { actions.edit('default', JSON.stringify(value)) },
      retryCatalog: () => { this.refreshCatalog() },
      activateCatalog: () => { this.refreshCatalog() },
    }
    this.unsubscribe = scope.subscribe(() => {
      if (scope.getSnapshot().status !== 'ready') { this.generation++; this.strategies = []; this.catalogStatus = 'idle'; this.publish() }
    })
  }

  private projection(): TaskStrategyCardState {
    const defaultField = this.form.field('default')
    return { ...this.form.shell(), choice: choice(defaultField.text), default: defaultField,
      model: this.form.field('model'), provider: this.form.field('provider'), timeoutMs: this.form.field('timeoutMs'),
      strategies: this.strategies, catalogStatus: this.catalogStatus,
    }
  }

  private publish(): void { this.store.set(this.projection()) }

  /**
   * Build the card face bound by the slot renderer.
   * @returns snapshot, form actions and explicit catalogue retry.
   */
  inject(): TaskStrategyCardFace {
    return this.face
  }

  /** Refresh on page activation, explicit retry or Host configuration change. */
  refreshCatalog(): void {
    if (this.disposed) return
    const generation = ++this.generation
    if (this.scope.getSnapshot().status !== 'ready') return
    this.catalogStatus = 'loading'
    this.publish()
    void this.readCatalog().then((catalog) => {
      if (generation !== this.generation) return
      this.strategies = catalog.strategies
      this.catalogStatus = 'ready'
      this.publish()
    }, () => {
      if (generation !== this.generation) return
      this.catalogStatus = 'error'
      this.publish()
    })
  }

  /** Drop old Host state and drafts before reconnecting. */
  resetConnection(): void {
    this.strategies = []
    this.form.actions().discard()
    this.refreshCatalog()
  }

  /** Release subscriptions and invalidate outstanding reads. */
  dispose(): void { this.disposed = true; this.generation++; this.unsubscribe(); this.form.dispose() }
}

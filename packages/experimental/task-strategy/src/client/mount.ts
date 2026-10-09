/** Source-safe registration of the optional catalogue Remote and plugin page. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-experimental-task-strategy/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { TaskStrategyCard } from './TaskStrategyCard.tsx'
import { TASK_STRATEGY_NS, TaskStrategyCardController } from './task-strategy-card-controller.ts'
import { en, zh, type TaskStrategyLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.taskStrategy': TaskStrategyLocaleKey }
}

/** Locale dictionary namespace for the optional strategy page. */
export const NS = 'settings.taskStrategy'
/** Services used by the browser half. */
export const inject = ['remote', 'slots', 'locale', 'configForms']

function registerUi(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }))
  const card = new TaskStrategyCardController(ctx.configForms.get(TASK_STRATEGY_NS), async () => {
    const result = await ctx.remote.taskStrategies.catalog()
    if (!result.ok) throw result.error
    return result.value
  })
  ctx.effect(() => () => { card.dispose() })
  ctx.effect(() => ctx.remote.$on('settings/document-updated', () => { card.refreshCatalog() }))
  ctx.on('connection/reset', () => { card.resetConnection() })
  ctx.effect(() => ctx.configForms.whileServed([TASK_STRATEGY_NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item', id: 'task-strategy', order: 35, label: () => t('title'), locale: NS,
    inject: () => card.inject(),
  }, TaskStrategyCard))))
}

/**
 * Mount only this experimental Remote namespace beside the original plugin UI.
 * @param ctx - Client runtime and effect owner.
 * @param contribution - generated read-only strategy Remote.
 * @returns disposer withdrawing UI before its Remote definitions.
 */
export async function mountTaskStrategyUi(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.taskStrategies', 'slots', 'locale', 'configForms'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}

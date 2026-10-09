import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import settingsRemote from '@deepseek-ai/dsh-api-settings-controller/remote'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import * as settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as client from '../src/client/index.ts'
// This client aggregate must consume the built, neutral schema instead of importing Host source.
import { adapterSchema } from '../lib/types/schema.js'
import type {} from '@deepseek-ai/dsh-experimental-task-strategy/remote'
import type { TaskStrategyCardFace } from '../src/client/task-strategy-card-controller.ts'

const selection = { default: { kind: 'auto' }, timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
const direct = { id: 'direct', description: 'Direct', cost: { kind: 'unknown', reason: 'dynamic-plan' } } as const
async function boot() {
  const ctx = new Context()
  const mock = RemoteMock.create()
  mock.remote.settings.describe.mockResolvedValue(ok({ writable: true, hasDocument: true, namespaces: [{
    ns: 'experimental-task-strategy', schema: JSON.parse(JSON.stringify(adapterSchema.toJSON())) as SettingsNamespaceView['schema'],
    value: { selection, allowedPresets: ['minimal'] }, base: { selection, allowedPresets: ['minimal'] }, user: {}, autoGenerate: true, applies: 'live', secrets: [], revision: 4,
  }] }))
  mock.remote.taskStrategies.catalog.mockResolvedValue(ok({ strategies: [direct], presets: ['minimal'] }))
  await ctx.plugin(TypertRegistry)
  await ctx.plugin({ apply: (owner: Context) => { installConnection(owner, { transport: { rpc: mock.rpc }, location: { hostname: '127.0.0.1' } }) } })
  await ctx.plugin(gateway)
  const disposeSettings = await ctx.remote.$mount(settingsRemote)
  const locale = new LocaleRuntime(ctx)
  ctx.reflect.provide('locale', locale)
  new SlotRegistry(ctx)
  ctx.slots.register({ name: 'root', children: { 'plugins.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  await ctx.plugin(settings)
  await vi.waitFor(() => { expect(ctx.configForms.get('experimental-task-strategy').getSnapshot().status).toBe('ready') })
  return { ctx, mock, locale, disposeSettings }
}

describe('real client strategy contribution', () => {
  it('mounts the generated Remote, localizes the original slot and withdraws both on unload', async () => {
    const { ctx, mock, locale, disposeSettings } = await boot()
    try {
      const fiber = ctx.plugin(client)
      await fiber
      const entry = ctx.slots.entries('plugins.item')[0]!
      expect(entry.options.id).toBe('task-strategy')
      locale.setLocale('zh')
      expect(resolveSlotLabel(entry.options.label)).toBe('任务策略')
      locale.setLocale('en')
      expect(resolveSlotLabel(entry.options.label)).toBe('Task strategies')
      const face = entry.inject!() as unknown as TaskStrategyCardFace
      face.activateCatalog()
      await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().strategies).toEqual([direct]) })
      mock.remote.taskStrategies.catalog.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'offline', {}) })
      face.retryCatalog()
      await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('error') })
      mock.streams.push('$events', { type: 'emit', event: 'settings/document-updated', args: ['experimental-task-strategy', 5] })
      await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('ready') })
      ctx.emit('connection/reset')
      await vi.waitFor(() => { expect(mock.remote.taskStrategies.catalog).toHaveBeenCalledTimes(4) })
      await fiber.dispose()
      expect(ctx.slots.entries('plugins.item')).toHaveLength(0)
      expect(ctx.get('remote.taskStrategies')).toBeUndefined()
      ctx.emit('connection/reset')
      face.retryCatalog()
      expect(mock.remote.taskStrategies.catalog).toHaveBeenCalledTimes(4)
      mock.assertNoUnmatched()
    } finally { await ctx.fiber.dispose(); await disposeSettings() }
  })
  it('withdraws the generated Remote if UI registration fails', async () => {
    const { ctx, disposeSettings } = await boot()
    try {
      vi.spyOn(ctx.configForms, 'get').mockImplementation(() => { throw new Error('slot setup failed') })
      const fiber = ctx.plugin(client)
      await expect(Promise.resolve(fiber)).rejects.toThrow('slot setup failed')
      expect(ctx.get('remote.taskStrategies')).toBeUndefined()
      expect(ctx.slots.entries('plugins.item')).toHaveLength(0)
    } finally { await ctx.fiber.dispose(); await disposeSettings() }
  })
})

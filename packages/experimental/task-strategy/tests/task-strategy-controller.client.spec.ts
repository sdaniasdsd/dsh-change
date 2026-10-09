import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskStrategyCardController } from '../src/client/task-strategy-card-controller.ts'
import type { SelectionConfig } from '../src/selection-types.ts'

const selection: SelectionConfig = { default: { kind: 'auto' }, timeoutMs: 30000, maxPromptBytes: 32768, maxOutputBytes: 2048, maxTokens: 512 }
describe('task strategy plugin form', () => {
  it('handles unavailable forms, malformed draft choices and stale failed reads without publishing obsolete state', async () => {
    const host = stubConfigForm<{ selection: SelectionConfig }>()
    const stale = Promise.withResolvers<{ strategies: { id: string; description: string }[]; presets: string[] }>()
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue({ strategies: [], presets: [] })
    const controller = new TaskStrategyCardController(host.scope, load)
    const face = controller.inject()
    expect(controller.inject()).toBe(face)
    face.activateCatalog()
    expect(load).not.toHaveBeenCalled()
    host.publish({ status: 'ready', writable: true, value: { selection } })
    for (const text of ['{', 'null', '{}', '{"kind":"other"}', '{"kind":"named","strategy":1}']) {
      face.edit('default', text)
      expect(face.hooks.taskStrategyCard.getSnapshot().invalid).toBe(true)
    }
    face.discard()
    face.activateCatalog()
    host.publish({ status: 'unavailable', value: undefined })
    expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('idle')
    stale.reject(new Error('obsolete connection'))
    await Promise.resolve()
    expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('idle')
    host.publish({ status: 'ready', value: { selection: { ...selection, model: 'route' } }, user: { selection: { model: 'route' } } })
    face.resetField('model')
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['selection', 'model'] }], undefined) })
    controller.dispose()
    expect(host.listenerCount()).toBe(0)
  })
  it('stages choice and route, saves nested paths with the original revision and retains rejected drafts', async () => {
    const host = stubConfigForm<{ selection: SelectionConfig }>()
    host.publish({ status: 'ready', writable: true, value: { selection }, base: { selection }, user: {}, revision: 4 })
    const controller = new TaskStrategyCardController(host.scope, async () => ({ strategies: [{ id: 'direct', description: 'Direct' }], presets: [] }))
    const face = controller.inject()
    try {
      expect(face.hooks.taskStrategyCard.getSnapshot().choice).toEqual({ kind: 'auto' })
      face.choose({ kind: 'named', strategy: 'direct' })
      face.edit('model', 'model-1')
      expect(host.mutate).not.toHaveBeenCalled()
      host.mutate.mockResolvedValue(false)
      face.save()
      await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledWith([
        { op: 'set', path: ['selection', 'default'], value: { kind: 'named', strategy: 'direct' } },
        { op: 'set', path: ['selection', 'model'], value: 'model-1' },
      ], 4) })
      await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().failed).toBe(true) })
      face.discard()
      expect(face.hooks.taskStrategyCard.getSnapshot().dirty).toBe(false)
      face.choose({ kind: 'named', strategy: '' })
      expect(face.hooks.taskStrategyCard.getSnapshot().invalid).toBe(true)
      face.choose({ kind: 'auto' })
      expect(face.hooks.taskStrategyCard.getSnapshot().invalid).toBe(false)
    } finally { controller.dispose() }
  })
  it('ignores old catalogue responses after reconnect, retries errors and suppresses settlement after disposal', async () => {
    const host = stubConfigForm<{ selection: SelectionConfig }>()
    host.publish({ status: 'ready', writable: true, value: { selection } })
    const old = Promise.withResolvers<{ strategies: { id: string; description: string }[]; presets: string[] }>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ strategies: [{ id: 'new', description: 'New' }], presets: [] })
    const controller = new TaskStrategyCardController(host.scope, load)
    const face = controller.inject()
    controller.refreshCatalog()
    controller.resetConnection()
    await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('ready') })
    old.resolve({ strategies: [{ id: 'old', description: 'Old' }], presets: [] })
    await old.promise
    expect(face.hooks.taskStrategyCard.getSnapshot().strategies.map(row => row.id)).toEqual(['new'])
    load.mockRejectedValueOnce(new Error('offline'))
    face.retryCatalog()
    await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('error') })
    expect(face.hooks.taskStrategyCard.getSnapshot().strategies.map(row => row.id)).toEqual(['new'])
    load.mockResolvedValueOnce({ strategies: [], presets: [] })
    face.retryCatalog()
    await vi.waitFor(() => { expect(face.hooks.taskStrategyCard.getSnapshot().catalogStatus).toBe('ready') })
    controller.dispose()
    face.retryCatalog()
    expect(load).toHaveBeenCalledTimes(4)
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TaskStrategyCard, type TaskStrategyCardProps } from '../src/client/TaskStrategyCard.tsx'
import type { TaskStrategyCardState } from '../src/client/task-strategy-card-controller.ts'
import { costUnknownKeys, en, zh } from '../src/client/locales.ts'
import type { TokenCostUnknown } from '../src/types.ts'

afterEach(cleanup)
const field = (text: string) => ({ text, overridden: false, invalid: false })
function card(rest: Partial<TaskStrategyCardState> = {}, view: 'summary' | 'page' = 'page', dictionary = en) {
  const store = createSnapshotStore<TaskStrategyCardState>({
    available: true, writable: true, dirty: true, invalid: false, saving: false, failed: false,
    choice: { kind: 'auto' }, default: field('{"kind":"auto"}'), model: field(''), provider: field(''), timeoutMs: field('30000'),
    strategies: [{ id: 'direct', description: 'Execute directly' }], catalogStatus: 'ready', ...rest,
  })
  const actions = {
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(), choose: vi.fn(), retryCatalog: vi.fn(), activateCatalog: vi.fn(),
  }
  const props = {
    ...actions, view, t: (key: keyof typeof en) => dictionary[key], useTaskStrategyCard: bindSnapshotSelector(store),
  } as TaskStrategyCardProps
  render(<TaskStrategyCard {...props} />)
  return actions
}

describe('original plugin strategy card', () => {
  it.each([en, zh])('distinguishes partial input, configured scenarios and unknown costs', (dictionary) => {
    const base = { kind: 'estimated' as const, basis: 'registration' as const, planName: 'Review',
      tasks: 3, stages: 2, knownInputTokens: 123, unknowns: Object.keys(costUnknownKeys) as TokenCostUnknown[] }
    card({ strategies: [
      { id: 'partial', description: 'Partial', cost: base },
      { id: 'scenario', description: 'Scenario', cost: { ...base, estimatedTotalTokens: 456,
        assumptions: { callsPerTask: 2, contextTokensPerCall: 100, outputTokensPerCall: 50 } } },
      { id: 'dynamic', description: 'Dynamic', cost: { kind: 'unknown', reason: 'dynamic-plan' } },
      { id: 'unavailable', description: 'Unavailable', cost: { kind: 'unknown', reason: 'estimator-unavailable' } },
    ] }, 'page', dictionary)
    expect(screen.getAllByText(`${dictionary.costKnown}: 123 · ${dictionary.costTasks}: 3 / 2`)).toHaveLength(2)
    expect(screen.getByText(`${dictionary.costTotal}: 456`)).toBeTruthy()
    expect(screen.getByText(`${dictionary.costAssumptions}: 2 / 100 / 50`)).toBeTruthy()
    expect(screen.getByText(`${dictionary.costUnknown}: ${dictionary.costDynamic}`)).toBeTruthy()
    expect(screen.getByText(`${dictionary.costUnknown}: ${dictionary.costUnavailable}`)).toBeTruthy()
    expect(screen.getAllByText(new RegExp(dictionary.costSystemTools))).toHaveLength(2)
    expect(screen.getByText(dictionary.costNote)).toBeTruthy()
    cleanup()
  })
  it.each([en, zh])('renders automatic defaults and stages controls using localized original form chrome', (dictionary) => {
    const actions = card({}, 'page', dictionary)
    expect(actions.activateCatalog).toHaveBeenCalledOnce()
    expect(screen.getByLabelText(dictionary.auto)).toHaveProperty('checked', true)
    expect(screen.getByText(dictionary.noReply)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(dictionary.named))
    expect(actions.choose).toHaveBeenCalledWith({ kind: 'named', strategy: 'direct' })
    fireEvent.change(screen.getByLabelText(dictionary.model), { target: { value: 'route' } })
    expect(actions.edit).toHaveBeenCalledWith('model', 'route')
    fireEvent.click(screen.getByRole('button', { name: dictionary.save }))
    expect(actions.save).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: dictionary.retry }))
    expect(actions.retryCatalog).toHaveBeenCalledOnce()
    cleanup()
    expect(actions.discard).toHaveBeenCalledOnce()
  })
  it('renders only the summary text in summary mode', () => {
    const actions = card({}, 'summary')
    expect(document.body.textContent).toBe(en.description)
    expect(actions.activateCatalog).not.toHaveBeenCalled()
  })
  it('keeps an unknown stored name visible and permits correction', () => {
    const actions = card({ choice: { kind: 'named', strategy: 'missing' }, default: { text: '', overridden: true, invalid: false } })
    expect(screen.getByText(en.unknown)).toBeTruthy()
    expect(screen.getByLabelText(en.strategy)).toHaveProperty('value', 'missing')
    expect(screen.getByRole('combobox', { name: en.strategy })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'missing' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(en.strategy), { target: { value: 'direct' } })
    expect(actions.choose).toHaveBeenCalledWith({ kind: 'named', strategy: 'direct' })
    fireEvent.click(screen.getByLabelText(en.auto))
    expect(actions.choose).toHaveBeenCalledWith({ kind: 'auto' })
    for (const reset of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(reset)
    expect(actions.resetField).toHaveBeenCalledWith('default')
  })
  it('shows loading, failed and empty catalogues, and disables read-only inputs', () => {
    card({ catalogStatus: 'loading' })
    expect(screen.getByText(en.loading)).toBeTruthy()
    cleanup()
    card({ catalogStatus: 'error' })
    expect(screen.getByText(en.catalogError)).toBeTruthy()
    cleanup()
    card({ writable: false, strategies: [] })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.getByLabelText(en.model)).toHaveProperty('disabled', true)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    cleanup()
    card({ available: false })
    expect(screen.getByText(en.unavailable)).toBeTruthy()
  })
  it('retains an invalid named draft while the catalogue is unavailable', () => {
    card({ choice: { kind: 'named', strategy: '' }, default: { text: '', overridden: false, invalid: true },
      strategies: [], catalogStatus: 'loading' })
    expect(screen.getByLabelText(en.strategy).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(en.invalid)).toBeTruthy()
    expect(screen.queryByText(en.unknown)).toBeNull()
  })
  it('allows correcting a known named choice, resets inherited fields and stages an empty name when the catalogue is empty', () => {
    const actions = card({ choice: { kind: 'named', strategy: 'direct' }, model: { text: 'route', overridden: true, invalid: false } })
    expect(screen.queryByText(en.unknown)).toBeNull()
    expect(screen.getByRole('option', { name: 'direct' })).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: en.reset })) fireEvent.click(button)
    expect(actions.resetField).toHaveBeenCalledWith('model')
    cleanup()
    const empty = card({ strategies: [] })
    fireEvent.click(screen.getByLabelText(en.named))
    expect(empty.choose).toHaveBeenCalledWith({ kind: 'named', strategy: '' })
  })
})

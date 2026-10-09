/** Selector preferences rendered inside the original Plugins page. */
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useEffect } from 'react'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskStrategyCardFace } from './task-strategy-card-controller.ts'
import { costUnknownKeys, formLabels } from './locales.ts'
import css from './TaskStrategyCard.module.css'

/** Framework-derived props for the original plugin configuration slot. */
export type TaskStrategyCardProps = PropsRuntime<'plugins.item'> & PropsLocale<'settings.taskStrategy'> & InjectFace<TaskStrategyCardFace>

/**
 * Render the summary or staged task strategy form.
 * @param props - original slot view, localized copy and injected actions.
 * @returns plugin summary or its configuration page.
 */
export function TaskStrategyCard(props: TaskStrategyCardProps) {
  const { t } = props
  const state = props.useTaskStrategyCard(snapshot => snapshot)
  useEffect(() => { if (props.view === 'page') props.activateCatalog() }, [props.view, props.activateCatalog])
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving
  const named = state.choice?.kind === 'named' ? state.choice : undefined
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <fieldset className={css.mode} disabled={disabled}>
        <legend>{t('mode')}</legend>
        <label><input type="radio" name="task-strategy-mode" checked={state.choice?.kind === 'auto'} onChange={() => { props.choose({ kind: 'auto' }) }} />{t('auto')}</label>
        <label><input type="radio" name="task-strategy-mode" checked={named !== undefined} onChange={() => { props.choose({ kind: 'named', strategy: state.strategies[0]?.id ?? '' }) }} />{t('named')}</label>
        <p>{t('noReply')}</p>
        {state.default.overridden ? <button type="button" onClick={() => { props.resetField('default') }}>{t('reset')}</button> : null}
      </fieldset>
      {named === undefined ? null : <div className={css.strategy}>
        <label htmlFor="task-strategy-default">{t('strategy')}</label>
        <select id="task-strategy-default" value={named.strategy} disabled={disabled}
          aria-invalid={state.default.invalid} aria-describedby="task-strategy-default-message"
          onChange={(event) => { props.choose({ kind: 'named', strategy: event.currentTarget.value }) }}>
          {!state.strategies.some(row => row.id === named.strategy)
            ? <option value={named.strategy} disabled>{named.strategy}</option> : null}
          {state.strategies.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}
        </select>
        <p id="task-strategy-default-message">{state.default.invalid ? t('invalid')
          : state.catalogStatus === 'ready' && !state.strategies.some(row => row.id === named.strategy) ? t('unknown') : null}</p>
      </div>}
      {(['model', 'provider', 'timeoutMs'] as const).map(field => <SettingsValueField key={field} id={`task-strategy-${field}`}
        label={t(field === 'timeoutMs' ? 'timeout' : field)} hint={t(field === 'timeoutMs' ? 'timeoutHint' : 'inherit')}
        numeric={field === 'timeoutMs'} disabled={disabled} {...state[field]}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
        onEdit={(text) => { props.edit(field, text) }} onReset={() => { props.resetField(field) }} />)}
      <section className={css.catalog} aria-label={t('catalog')}>
        <h3>{t('catalog')}</h3>
        {state.catalogStatus === 'loading' ? <p role="status">{t('loading')}</p> : null}
        {state.catalogStatus === 'error' ? <p role="status">{t('catalogError')}</p> : null}
        {state.catalogStatus === 'ready' && state.strategies.length === 0 ? <p>{t('empty')}</p> : null}
        {state.strategies.map(row => <article key={row.id}>
          <strong>{row.id}</strong><p>{row.description}</p>
          {row.cost?.kind !== 'estimated' ? <p>{t('costUnknown')}
            {row.cost === undefined ? null : `: ${t(row.cost.reason === 'dynamic-plan' ? 'costDynamic' : 'costUnavailable')}`}</p> : <>
            <p>{t('costKnown')}: {row.cost.knownInputTokens} · {t('costTasks')}: {row.cost.tasks} / {row.cost.stages}</p>
            {row.cost.estimatedTotalTokens === undefined ? null : <p>{t('costTotal')}: {row.cost.estimatedTotalTokens}</p>}
            {row.cost.assumptions === undefined ? null : <p>{t('costAssumptions')}: {row.cost.assumptions.callsPerTask}
              {' / '}{row.cost.assumptions.contextTokensPerCall}{' / '}{row.cost.assumptions.outputTokensPerCall}</p>}
            <p>{t('costUnknowns')}: {row.cost.unknowns.map(item => t(costUnknownKeys[item])).join(' / ')}</p>
          </>}
        </article>)}
        <p>{t('costNote')}</p>
        <button type="button" onClick={props.retryCatalog} disabled={state.catalogStatus === 'loading'}>{t('retry')}</button>
      </section>
    </SettingsForm>
  )
}

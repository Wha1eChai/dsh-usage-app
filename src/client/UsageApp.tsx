import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WebpageAppSlotProps } from '@wha1echai/dsh-webpage/client'
import { AppEmpty, AppField, AppFields, AppList, AppPage, AppRow } from '@wha1echai/dsh-webpage/ui'
import type { BalanceCard } from '../balances.js'
import type { DayDetail } from '../fold.js'
import type { SubscriptionCard } from '../subscriptions.js'
import type { UsageAppOwner } from '../index.js'
import type { UsagePanelData } from './usage-view.js'
import {
  formatTokens,
  loadDay,
  loadUsagePanel,
  monthGrid,
  monthLabel,
  shiftMonth,
} from './usage-view.js'
import styles from './UsageApp.module.css'

export type UsageAppProps =
  WebpageAppSlotProps
  & PropsRenderSlots<'wha1echai.usage.actions'>
  & PropsLocale<'usage'>

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function statusLabel(status: BalanceCard['status'] | SubscriptionCard['status'], t: UsageAppProps['t']): string {
  if (status === 'missing') return t('missing')
  if (status === 'error') return t('error')
  return t('remaining')
}

function DayDetailSection({ day, selected, t }: {
  day: DayDetail | undefined
  selected: string
  t: UsageAppProps['t']
}) {
  if (day === undefined || (day.totals?.tokens ?? 0) === 0) {
    return (
      <section aria-label={t('dayDetail')}>
        <h2>{t('dayDetail')} {selected}</h2>
        <AppEmpty>{t('listEmpty')}</AppEmpty>
      </section>
    )
  }
  return (
    <section aria-label={t('dayDetail')}>
      <h2>{t('dayDetail')} {selected}</h2>
      <AppFields>
        <AppField field="day-tokens" label={t('tokens')} value={formatTokens(day.totals.tokens)} />
      </AppFields>
      {day.models.length === 0
        ? <AppEmpty>{t('noModels')}</AppEmpty>
        : (
          <AppList dense label={t('models')}>
            {day.models.map(model => (
              <AppRow
                key={model.model}
                dense
                title={model.model}
                description={`${t('tokens')} ${formatTokens(model.tokens)}`}
              />
            ))}
          </AppList>
        )}
      {day.sessions.length === 0
        ? <AppEmpty>{t('noSessions')}</AppEmpty>
        : (
          <AppList dense label={t('sessions')}>
            {day.sessions.map(session => (
              <AppRow
                key={session.id}
                dense
                title={session.id}
                description={`${t('tokens')} ${formatTokens(session.tokens)}`}
              />
            ))}
          </AppList>
        )}
    </section>
  )
}

/** Local ledger heatmap plus Host-proxied provider cards. */
export function UsageApp({ appPath, renderSlot, t }: UsageAppProps) {
  const owner: UsageAppOwner = Object.freeze({ appPath })
  const actions = renderSlot('wha1echai.usage.actions', owner)
  const [panel, setPanel] = useState<UsagePanelData | undefined>()
  const [day, setDay] = useState<DayDetail | undefined>()
  const [cursor, setCursor] = useState(todayKey)
  const [selected, setSelected] = useState(todayKey)
  const [error, setError] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void loadUsagePanel().then(next => {
      if (cancelled) return
      setPanel(next)
      setError(undefined)
      setLoading(false)
    }, reason => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : String(reason))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadDay(selected).then(next => {
      if (!cancelled) setDay(next)
    }, () => {
      if (!cancelled) setDay(undefined)
    })
    return () => {
      cancelled = true
    }
  }, [selected])

  const grid = useMemo(() => monthGrid(cursor, panel?.summary.days ?? []), [cursor, panel])

  return (
    <article data-route="/">
      <AppPage title={t('title')} description={t('description')} actions={actions} actionsLabel={t('actions')}>
        {loading ? <AppEmpty>{t('loading')}</AppEmpty> : null}
        {error !== undefined && !loading ? <AppEmpty>{t('loadError')}</AppEmpty> : null}
        {panel !== undefined
          ? (
            <>
              <AppFields>
                <AppField field="tokens" label={t('tokens')} value={formatTokens(panel.summary.total.tokens)} />
                <AppField
                  field="cache"
                  label={t('cacheHit')}
                  value={panel.summary.total.cacheHitRate === null ? '—' : `${panel.summary.total.cacheHitRate}%`}
                />
              </AppFields>
              <section className={styles.heatmap} aria-label={t('heatmap')}>
                <div className={styles.nav}>
                  <button type="button" onClick={() => setCursor(current => shiftMonth(current, -1))}>{t('previousMonth')}</button>
                  <strong>{monthLabel(cursor)}</strong>
                  <button type="button" onClick={() => setCursor(current => shiftMonth(current, 1))}>{t('nextMonth')}</button>
                </div>
                <div className={styles.weekdays}>
                  {WEEKDAYS.map((label, index) => <span key={`${label}-${index}`} className={styles.weekday}>{label}</span>)}
                </div>
                <div className={styles.cells}>
                  {grid.cells.map(cell => (
                    <button
                      key={cell.date}
                      type="button"
                      data-day={cell.date}
                      data-level={cell.level}
                      aria-label={cell.date}
                      className={[
                        styles.cell,
                        cell.inMonth ? undefined : styles.out,
                        cell.level === 0 ? undefined : styles[`level${cell.level}`],
                        cell.date === selected ? styles.selected : undefined,
                      ].filter(Boolean).join(' ')}
                      onClick={() => setSelected(cell.date)}
                    />
                  ))}
                </div>
              </section>
              <DayDetailSection day={day} selected={selected} t={t} />
              <section className={styles.cards} aria-label={t('balances')}>
                <h2>{t('balances')}</h2>
                {panel.balances.map(card => (
                  <article key={card.id} className={styles.card} data-provider={card.id} data-status={card.status}>
                    <h3 className={styles.cardTitle}>{card.displayName}</h3>
                    <p className={styles.cardMeta}>
                      {statusLabel(card.status, t)}
                      {card.status === 'ok' && card.remaining !== undefined
                        ? ` ${card.remaining}${card.currency === undefined ? '' : ` ${card.currency}`}`
                        : ''}
                      {card.status !== 'ok' && card.message !== undefined ? ` · ${card.message}` : ''}
                    </p>
                  </article>
                ))}
              </section>
              <section className={styles.cards} aria-label={t('subscriptions')}>
                <h2>{t('subscriptions')}</h2>
                {panel.subscriptions.map(card => (
                  <article key={card.id} className={styles.card} data-subscription={card.id} data-status={card.status}>
                    <h3 className={styles.cardTitle}>{card.displayName}</h3>
                    <p className={styles.cardMeta}>{card.plan} · {statusLabel(card.status, t)}</p>
                    {card.windows.map(window => (
                      <div key={window.kind}>
                        <p className={styles.cardMeta}>{window.kind} {window.usedPercent}%</p>
                        <div className={styles.bar}><div className={styles.fill} style={{ width: `${window.usedPercent}%` }} /></div>
                      </div>
                    ))}
                  </article>
                ))}
              </section>
            </>
          )
          : null}
      </AppPage>
    </article>
  )
}

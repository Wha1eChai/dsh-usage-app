import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  Pill,
  StateDot,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WebpageAppSlotProps } from '@wha1echai/dsh-webpage/client'
import { AppEmpty, AppField, AppFields, AppList, AppPage, AppRow } from '@wha1echai/dsh-webpage/ui'
import type { BalanceCard } from '../balances.js'
import type { DayDetail } from '../fold.js'
import type { SubscriptionCard } from '../subscriptions.js'
import type { UsageAppOwner } from '../index.js'
import type { HeatmapCell, UsagePanelData } from './usage-view.js'
import {
  formatSessionId,
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
const HEAT_LEVELS = [0, 1, 2, 3, 4] as const

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function statusLabel(status: BalanceCard['status'] | SubscriptionCard['status'], t: UsageAppProps['t']): string {
  if (status === 'missing') return t('missing')
  if (status === 'error') return t('error')
  return t('remaining')
}

function statusDot(status: BalanceCard['status'] | SubscriptionCard['status']): StateDotState {
  if (status === 'error') return 'error'
  if (status === 'missing') return 'warning'
  return 'done'
}

function cellTooltip(cell: HeatmapCell, t: UsageAppProps['t']): string {
  return `${cell.date} · ${t('tokens')} ${formatTokens(cell.tokens)}`
}

function HeatmapDay({ cell, selected, t, onSelect }: {
  cell: HeatmapCell
  selected: string
  t: UsageAppProps['t']
  onSelect: (date: string) => void
}) {
  return (
    <Tooltip label={cellTooltip(cell, t)} side="top">
      <button
        type="button"
        data-day={cell.date}
        data-level={cell.level}
        aria-label={cell.date}
        className={[
          styles.cell,
          cell.inMonth ? undefined : styles.out,
          styles[`level${cell.level}`],
          cell.date === selected ? styles.selected : undefined,
        ].filter(Boolean).join(' ')}
        onClick={() => onSelect(cell.date)}
      />
    </Tooltip>
  )
}

function DayDetailSection({ day, selected, t }: {
  day: DayDetail | undefined
  selected: string
  t: UsageAppProps['t']
}) {
  if (day === undefined || (day.totals?.tokens ?? 0) === 0) {
    return (
      <section className={styles.section} aria-label={t('dayDetail')}>
        <h2 className={styles.heading}>{t('dayDetail')} {selected}</h2>
        <AppEmpty>{t('listEmpty')}</AppEmpty>
      </section>
    )
  }
  return (
    <section className={styles.section} aria-label={t('dayDetail')}>
      <h2 className={styles.heading}>{t('dayDetail')} {selected}</h2>
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
                title={<span title={session.id}>{formatSessionId(session.id)}</span>}
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
              <div className={styles.hero}>
                <AppFields>
                  <AppField
                    field="tokens"
                    label={t('tokens')}
                    value={formatTokens(panel.summary.total.tokens)}
                    valueClassName={styles.heroValue}
                  />
                  <AppField
                    field="cache"
                    label={t('cacheHit')}
                    value={panel.summary.total.cacheHitRate === null ? '—' : `${panel.summary.total.cacheHitRate}%`}
                    valueClassName={styles.heroValue}
                  />
                </AppFields>
              </div>
              <section className={styles.heatmap} aria-label={t('heatmap')}>
                <div className={styles.nav}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronLeftOutline14 />}
                    aria-label={t('previousMonth')}
                    onClick={() => setCursor(current => shiftMonth(current, -1))}
                  />
                  <p className={styles.monthLabel}>{monthLabel(cursor)}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronRightOutline14 />}
                    aria-label={t('nextMonth')}
                    onClick={() => setCursor(current => shiftMonth(current, 1))}
                  />
                </div>
                <div className={styles.calendar}>
                  <div className={styles.weekdays}>
                    {WEEKDAYS.map((label, index) => <span key={`${label}-${index}`} className={styles.weekday}>{label}</span>)}
                  </div>
                  <div className={styles.cells}>
                    {grid.cells.map(cell => (
                      <HeatmapDay
                        key={cell.date}
                        cell={cell}
                        selected={selected}
                        t={t}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                  <div className={styles.legend}>
                    <span className={styles.legendLabel}>{t('heatmapLess')}</span>
                    <span className={styles.legendSwatches}>
                      {HEAT_LEVELS.map(level => (
                        <span key={level} className={[styles.swatch, styles[`level${level}`]].join(' ')} />
                      ))}
                    </span>
                    <span className={styles.legendLabel}>{t('heatmapMore')}</span>
                  </div>
                </div>
              </section>
              <DayDetailSection day={day} selected={selected} t={t} />
              <section className={styles.cards} aria-label={t('balances')}>
                <h2 className={styles.heading}>{t('balances')}</h2>
                {panel.balances.map(card => (
                  <article key={card.id} className={styles.card} data-provider={card.id} data-status={card.status}>
                    <h3 className={styles.cardTitle}>{card.displayName}</h3>
                    <p className={styles.status}>
                      <StateDot state={statusDot(card.status)} />
                      <span>
                        {statusLabel(card.status, t)}
                        {card.status === 'ok' && card.remaining !== undefined
                          ? ` ${card.remaining}${card.currency === undefined ? '' : ` ${card.currency}`}`
                          : ''}
                        {card.status !== 'ok' && card.message !== undefined ? ` · ${card.message}` : ''}
                      </span>
                    </p>
                  </article>
                ))}
              </section>
              <section className={styles.cards} aria-label={t('subscriptions')}>
                <h2 className={styles.heading}>{t('subscriptions')}</h2>
                {panel.subscriptions.map(card => (
                  <article key={card.id} className={styles.card} data-subscription={card.id} data-status={card.status}>
                    <div className={styles.cardHead}>
                      <h3 className={styles.cardTitle}>{card.displayName}</h3>
                      <Pill active>{card.plan}</Pill>
                    </div>
                    <p className={styles.status}>
                      <StateDot state={statusDot(card.status)} />
                      <span>{statusLabel(card.status, t)}</span>
                    </p>
                    {card.windows.map(window => (
                      <div key={window.kind} className={styles.window}>
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
